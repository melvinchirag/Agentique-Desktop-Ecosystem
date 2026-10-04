# Lane G: Orchestrator (Chip's turn loop)

**Engine:** Claude · Opus 5.5 · high · **Backup:** Codex GPT-6 Sol high · **Floor:** frontier-ish
**Branch:** `lane/chip-logic-g` · **First read:** `docs/lanes/README.md` (rules for every lane)
**Starts after** Wave 1 (lanes A, C, D, E, H) is merged into `chip/logic`. You build on their real code.

## Objective
Chip's brain loop: an inbox of user messages, job results, and nudges; one Chip turn at a time; calls Backboard through `LlmClient`; runs Chip's 5 tools; speaks. This is the piece that ties every Wave 1 lane together.

## Owned paths (only these)
- `src/main/runtime/orchestrator.ts`
- `tests/orchestrator.test.ts`

## Read
The **whole** Chip spec, especially **§8** (event order), **§9** (turn loop, errors), **§10** (tool executors), **§12** (turn inputs), **§13** (acks), **§14.3** (nudge answers). Then the code you build on:
| Lane | Use |
|---|---|
| D `src/main/agents/chipmunk/*` | `chipSystemPrompt`, `buildUserTurn/ResultTurn/NudgeTurn`, `ChipContextState`, `chipTools`, `pickAck`, `parseChipOutput`, `SPECIALIST_IDS`, `nameOf`, `specialistFromWord` |
| A `src/main/runtime/jobs.ts` | `JobScheduler` (`submit`, `cancel`, `list`, `onFinished`) |
| E `src/main/runtime/mood.ts`, `presence.ts` | `MoodEngine`, `PresenceManager` |
| H `src/main/runtime/nudges.ts` | `NudgeEngine`, `ANSWER_WINDOW_MS` |
| C `src/main/testing/*`, `src/main/runtime/history.ts` | `FakeLlm` + helpers, `FakeSpecialists`, `MemoryHistoryStore` (tests) |

## Build
```ts
export interface OrchestratorOptions {
  newId?: () => string;                 // default crypto.randomUUID (taskIds)
  llmTimeoutMs?: number;                // default 25_000
}
export const RESULT_BATCH_MS = 1500;
export const MAX_TOOL_ROUNDS = 6;
export const TOOL_OUTPUT_MAX_CHARS = 12_000;
export const FOGGY_LINE = "My brain's a bit foggy. Say that again?";
export const PARTWAY_LINE = 'I got partway. Want me to keep going?';
export function createOrchestrator(deps: OrchestratorDeps, opts?: OrchestratorOptions): Orchestrator;
```

### Inbox (§9)
- Three queues; always take **user messages first, then job results, then nudges**. One Chip turn at a time; a new item waits until the current turn ends.
- `submitUserMessage(text, opts)` enqueues and returns at once (the processing loop runs asynchronously).
- `whenIdle()` resolves when all queues are empty and no turn is running (pending result-batch timers don't count).
- `dispose()` stops accepting input, clears timers, and unsubscribes.
- **Chip's Backboard thread:** none at first; after the first response, reuse its `thread_id` for every later Chip turn this session.

### Wiring at construction
- `jobs.onFinished(job, result)`: ignore jobs whose `requestedBy !== 'chipmunk'` (help jobs go back to the animal that asked). Otherwise buffer by `parentTaskId`. **Batching:** each arrival restarts a `RESULT_BATCH_MS` timer for that `parentTaskId`; when it fires, enqueue **one** result item containing all buffered jobs.
- `nudges.onDue(batch)`: enqueue one nudge item; remember `{ ids, firedAt: clock.now() }` as the last nudge batch.
- Keep `recentResults` (agent, finishedAt, summary) for the last 5 finished Chip jobs, for `[context]`.
- Keep the **original request text per taskId** (the user's message) for result turns.

### Every turn
1. **taskId:** a user turn gets a new one; a result turn reuses the jobs' `parentTaskId`; a nudge turn gets a new one. Every event in the turn carries it.
2. **User turn only, before anything else:** emit `user.message` (`agentId: 'chipmunk'`, `text`, `source`).
3. **Stop check** (user turns; §9 step 1): trimmed text has **≤ 4 words** and starts with `stop`, `cancel`, `never mind`, or `nvm` (case-insensitive):
   - any remaining word that `specialistFromWord` maps → `jobs.cancel({ agent })` → say `Stopped <Name>!` (bubble `Stopped`);
   - otherwise → `jobs.cancel({ all: true })` → say `Stopping!` (bubble `Stopping`).
   - Priority `chip`. **No LLM call.** Turn ends (status `idle`).
4. **Nudge answer** (user turns; §9 step 2, §14.3): if the last nudge batch fired less than `ANSWER_WINDOW_MS` ago and this is the first user message since → for each nudge id: text matches `/^(later|not now|maybe later|remind me later)\b/i` → `nudges.snooze(id, 120)`; matches `/stop asking/i` → `nudges.cancel(id)`; else `nudges.markAnswered(id)`. Clear the last batch. The turn then continues normally.
5. **Presence:** `presence.touch('chipmunk')`; if Chip is `sleeping` → `await presence.wake('chipmunk', 'user')` (`'job'` for result and nudge turns). `presence.setBusy('chipmunk', true)` for the whole turn; `setBusy(false)` in a `finally`.
6. **Status:** user turn → `agent.status(listening)` then `agent.status(thinking)`; result or nudge turn → `agent.status(thinking)`.
7. **Build content** with lane D's builders. `ChipContextState`: `now = clock.now()`, `timeZone = deps.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone`, `userMoodBefore = mood.getUserMood()` (read before this turn's mood report), `jobs = jobs.list()`, `presence` = `presence.get(id)` per animal, `installed = settings().installed`, `recentResults`. Result turn items: agent, job title, ok, summary, `originalRequest` (from the taskId map; `''` if unknown), `nextStep`.
8. **Call** `llm.send({ assistantId: chipAssistantId, threadId, content, systemPrompt: chipSystemPrompt(), tools: chipTools(installedSpecialists), model: settings().models.chipmunk, memory, timeoutMs })`. **memory:** user turn `'Auto'`, result turn `'Readonly'`, nudge turn `'Readonly'`. `installedSpecialists` = `SPECIALIST_IDS` filtered by `settings().installed`.
   - **No retry here.** The `LlmClient` (Shafeen's S1) already retries once on network/timeout/5xx, as §9 step 5 requires; retrying here too would double it.
   - Any response (including after tool outputs) with non-empty `retrieved_memories` → emit `agent.recall { memories }` (once per distinct set in a turn).
9. **Tool loop** while `status === 'REQUIRES_ACTION'`, at most `MAX_TOOL_ROUNDS` rounds:
   - run **all** `tool_calls` of the round **in parallel**;
   - bad JSON arguments, an unknown tool name, or a thrown executor → that call's output is `{"error":"<reason>"}`;
   - outputs are `JSON.stringify(result)` cut to `TOOL_OUTPUT_MAX_CHARS`;
   - send **all** outputs in **one** `llm.submitToolOutputs(threadId, outputs)`.
   - After 6 rounds still `REQUIRES_ACTION` → speak `content` if any, else `PARTWAY_LINE`.
10. **Mood fallback** (user turns only, §9 step 7): if `report_user_mood` didn't run this turn → `(sighs)` cue → stressed 0.5; `(laughter)`/`(laughs)` → happy 0.5; else calm 0.3. Emit `user.mood` and call `mood.onUserMood` exactly as the tool does.
11. **Speak** (§9 step 8, §11 parsing): `parseChipOutput(content)`. Silent → no speech. Otherwise emit `agent.say(chipmunk, speech, bubble, 'chip')`.
12. **Done:** `agent.status(idle)`.

### Tool executors (§10)
| Tool | Executor |
|---|---|
| `report_user_mood` | Clamp intensity 0–1; validate `mood` (bad → error output). Emit `user.mood` (`agentId 'chipmunk'`, taskId), then `mood.onUserMood(mood, intensity, reason, taskId)`. Output `{"ok":true}`. In result/nudge turns: output `{"ok":true}` and do nothing. |
| `delegate` | Validate `agent` ∈ installed specialists, non-empty `task` and `title` (else error output). `jobs.submit({ agent, task, title, requestedBy: 'chipmunk', kind: 'normal', parentTaskId: taskId, nextStep: next_step, planStep: plan_step })`. (The scheduler wakes docked animals itself.) If this is the **first `delegate` of a user turn** → `pickAck(agent, status, mood.getUserMood())` → if not null, emit `agent.say(chipmunk, text, bubble, 'ack')`. Output `{ status, jobId, position }`. |
| `cancel_jobs` | `jobs.cancel(agent ? { agent } : { all: true })` → `{ cancelled }`. |
| `schedule_followup` | Parse `ask_at`; invalid or not after `clock.now()` → `{"error":"bad ask_at"}`. Else `nudges.schedule({ kind: 'custom', source: 'chip', question, about, askAt })` → `{ id }`. |
| `biome_history` | `history.query(kind, since_hours ?? 24, agent)` → `{ rows }`. Bad kind → error. |

### Errors (§9 table)
- `llm.send` / `submitToolOutputs` throws (after the client's own retry) → emit `agent.mood(chipmunk, sad, intensity 0.6, cause 'user')`, `agent.status(chipmunk, error)` (the renderer plays `Dizzy`), then `agent.say(chipmunk, FOGGY_LINE, 'Foggy 😵', 'chip')`. The turn ends; the loop continues with the next item.
- Anything else that throws inside a turn → `console.error` + the same foggy line. **The loop must never die.**

## Tests (`tests/orchestrator.test.ts`)
Use the **real** lane A/E/H engines + lane C's `FakeLlm`, `FakeSpecialists`, `MemoryHistoryStore`, `MemoryNudgeStore`, `FakeClock`, `EventBus`, `makeTestSettings`. Write a small `setup()` helper in the test file.
1. **C1 small talk:** `report_user_mood` then completed `[bubble: Hi!]\nHey there!` → no jobs; events in order `user.message`, `agent.status(listening)`, `agent.status(thinking)`, `user.mood`, …, `agent.say(chip)`, `agent.status(idle)`.
2. **C2 email:** delegate(workspace) → ack `agent.say(ack)`; reply `(silent)` → no chip speech; after the fake finishes + 1.5 s → result turn with memory `'Readonly'` and content starting `[job_results]` → Chip's summary spoken.
3. **C6 chain:** Scout job with `next_step` → result turn content contains `next_step: …` → Chip delegates to Pixel with the result in the task.
4. **C16 unclear:** model asks one question → spoken; no jobs.
5. **C17 Backboard down:** `send` throws → `agent.status(error)` + foggy line; the next message works normally.
6. **Stop:** "stop Scout" → only Scout cancelled, `Stopped Scout!`, no LLM call; "stop" → everything cancelled.
7. **Batching:** two jobs of the same task finishing 1 s apart → **one** result turn with both; 2 s apart → two.
8. **Inbox order:** a user message arriving during a result turn runs before the next queued result/nudge.
9. **Mood fallback:** no `report_user_mood` + voice cue `(sighs)` → `user.mood stressed 0.5`.
10. **Tool loop:** two tool calls in one round → one `submitToolOutputs` with both outputs; unknown tool → error output; 7 rounds → `PARTWAY_LINE`.
11. **Recall:** `retrieved_memories: ['CS 280 midterm is Monday']` → `agent.recall`.
12. **Ack only once:** two delegates in one user turn → one ack; delegate in a result turn → no ack.
13. **Nudge turn:** due nudge → nudge turn (content starts `[nudge]`, memory `Readonly`); reply "later" → `snooze(id, 120)`.
14. Thread reuse: the second Chip turn sends the `thread_id` from the first response.
15. Help job finishing → no result turn.

## STOP if
A Wave 1 module's real API differs from its lane file in a way that blocks this design, or `OrchestratorDeps` can't supply something you need.
