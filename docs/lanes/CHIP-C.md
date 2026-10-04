# Lane C: Fakes and in-memory history

**Engine:** Codex · GPT-6 Luna · medium · **Backup:** AGY Gemini 3.8 Flash High · **Floor:** value
**Branch:** `lane/chip-logic-c` · **First read:** `docs/lanes/README.md` (rules for every lane)

> **Orchestrator change:** `FakeClock`/`RealClock` (`src/main/runtime/clock.ts`) and `makeTestSettings` (`src/main/testing/settings.ts`) were already written in Wave 0 so every lane shares them. **Don't rebuild them.**

## Objective
The stand-ins Chip is built and tested against (Chip spec §5), plus the in-memory `biome_history`.

## Owned paths (only these)
- `src/main/testing/fakeLlm.ts`
- `src/main/testing/fakeSpecialists.ts`
- `src/main/testing/stubWarden.ts`
- `src/main/testing/fakeCalendar.ts`
- `src/main/testing/index.ts` (re-exports everything in `src/main/testing/`, including `settings.ts`)
- `src/main/runtime/history.ts`
- `tests/fakes.test.ts`, `tests/history.test.ts`

## Read
Chip spec: **§5** (stand-ins), **§7** (`LlmClient`, `LlmResponse`, `SpecialistRunner`, `AgentResult`, `CalendarSource`, `HistoryStore`), **§10.5** (history kinds), **§16** (specialist output). `src/main/runtime/types.ts`.

## Build

### `fakeLlm.ts`
```ts
export type FakeLlmStep = LlmResponse | Error | ((call: FakeLlmCall) => LlmResponse | Promise<LlmResponse>);
export type FakeLlmCall =
  | { kind: 'send'; params: SendParams }
  | { kind: 'toolOutputs'; threadId: string; outputs: { tool_call_id: string; output: string }[] };
export class FakeLlm implements LlmClient {
  constructor(script?: FakeLlmStep[]);
  readonly calls: FakeLlmCall[];                // every request, in order
  push(...steps: FakeLlmStep[]): void;          // add more steps
  remaining(): number;
}
// helpers for writing scripts
export function toolCall(name: string, args: object, id?: string): LlmToolCall;   // arguments = JSON.stringify(args); id default 'call_<n>'
export function requiresAction(toolCalls: LlmToolCall[], threadId?: string): LlmResponse;
export function completed(content: string, threadId?: string, retrievedMemories?: string[]): LlmResponse;
```
- Each `send` / `submitToolOutputs` records the call, then consumes the next step. An `Error` step is thrown (rejected). A function step is called with the call.
- Script exhausted → throw `Error('FakeLlm: script exhausted')`.
- If `params.signal` is already aborted → reject with an `AbortError` (`DOMException('Aborted', 'AbortError')`) without consuming a step.
- `threadId` default: `'thread-1'`.

### `fakeSpecialists.ts`
```ts
export type FakeBehavior = (task: string, ctx: SpecialistRunContext) => AgentResult | Promise<AgentResult>;
export class FakeSpecialists implements SpecialistRunner {
  constructor(opts: { clock: Clock; delayMs?: number | Partial<Record<SpecialistId, number>>;   // default 3000
                      behaviors?: Partial<Record<SpecialistId, FakeBehavior>> });
  readonly runs: { agentId: SpecialistId; task: string; ctx: SpecialistRunContext; startedAt: number }[];
  setBehavior(agent: SpecialistId, b: FakeBehavior): void;
}
export function fakeResult(agent: SpecialistId, overrides?: Partial<AgentResult>): AgentResult;
```
- `run` records the call, waits `delayMs` on the **Clock**, then returns the behavior's result, or by default `fakeResult(agent)`: `ok: true`, `say` = a short in-character line (e.g. Scout "Found three good options!"), `bubble` = `<Name> ✓`, `summary` = `"<Name> finished: <task trimmed to 80 chars>"`, `artifacts: []`.
- If `ctx.signal` aborts while waiting → clear the timer and reject with an `AbortError`.
- Behaviors are how scenario tests make Pixel "ask Archie for help": a behavior can close over a `JobScheduler` and call `submit({ kind: 'help', ... })` + `waitFor` itself.

### `stubWarden.ts`
```ts
export type StubVerdict = 'allow' | 'ask' | 'deny';
export class StubWardenGate {
  constructor(bus: Bus);
  /** deny when risk is 'external' (rule 'W1'), else allow (rule 'W2'). Emits wolf.verdict (agentId 'wolf'). */
  review(r: { agentId: AgentId; taskId: string; callId: string; tool: string; risk: Risk }): StubVerdict;
}
```

### `fakeCalendar.ts`
```ts
export class FakeCalendar implements CalendarSource {
  constructor(clock: Clock, events?: CalendarEvent[]);
  readonly events: CalendarEvent[];
}
```
Default events relative to `clock.now()` **at construction**:
1. `{ id: 'ev-midterm', title: 'CS 280 Midterm', start: now − 85 min, end: now + 5 min }`
2. `{ id: 'ev-standup', title: 'Team standup', start: now + 1 day, end: now + 1 day + 15 min }`
3. `{ id: 'ev-interview', title: 'Google interview', start: now + 3 days, end: now + 3 days + 1 h }`

`listEvents(from, to)` returns events that overlap the range, sorted by start.

### `src/main/runtime/history.ts`: `MemoryHistoryStore implements HistoryStore`
`constructor(deps: { bus: Bus; clock: Clock })`. Reads `bus.recent()`; keeps events with `ts >= now − sinceHours·3600·1000`; optional `agent` filter. Max 20 rows, newest first.

| kind | Row |
|---|---|
| `recent_tasks` | `{ at, asked, answered }`: group by `taskId`; `asked` = text of the first `user.message`, `answered` = text of the last `agent.say` from `chipmunk` (or `null`). Skip tasks without a `user.message`. `at` = ISO time of the first event |
| `warden_blocks` | `{ at, agent, tool, rule, reason }`: `wolf.verdict` with verdict `deny`. `agent` and `tool` come from the `tool.request` with the same `callId` (or `null` if not found) |
| `agent_activity` | `{ agent, jobs, actions }`: per agent, `jobs` = count of `job.update` with state `done` (by `to`), `actions` = count of `tool.result` (by `agentId`). Sorted by jobs desc |
| `mood_history` | `{ at, mood, intensity }`: `user.mood` events |

## Tests
- `tests/fakes.test.ts`: FakeLlm consumes steps in order, records `send` + `toolOutputs`, throws `Error` steps, throws when exhausted, rejects an aborted signal without consuming; `toolCall` stringifies args. FakeSpecialists waits `delayMs` on the FakeClock (not done at 2999 ms, done at 3000 ms), per-agent delay works, abort rejects with `AbortError`, custom behavior used. StubWardenGate: external → deny + `wolf.verdict`; read → allow. FakeCalendar: the midterm ends 5 min after construction; range filtering.
- `tests/history.test.ts`: seed an `EventBus` (with a FakeClock) with events for 3 tasks; check each kind's rows, the `since_hours` window, the `agent` filter, the 20-row cap, newest first.

## STOP if
None expected. If an interface in `types.ts` seems wrong for a fake, STOP rather than work around it.
