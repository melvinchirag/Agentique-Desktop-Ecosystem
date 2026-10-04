# Chip — Parallel Build Plan for Melvin (Claude + Codex + AGY)

**Builds:** `agents/01-chip-orchestrator.md` v3.1 (the spec — every lane reads it)
**Branch:** Melvin works on **`chip/logic`**; AI lanes use `lane/chip-logic-<x>` and merge into `chip/logic` (never `main`). Full rules: `../GIT-WORKFLOW.md`.
**Team split:** Melvin builds **Chip's logic**. **Shafeen builds the sponsor pieces** (Backboard client, Tiger stores, ElevenLabs voice) in parallel: `01-chip-SPONSOR-LANES-SHAFEEN.md`. Melvin builds against fakes and in-memory versions, then swaps in Shafeen's real pieces in `createChipCore(config)`.
**Operator:** Melvin · **Method:** Hydra's flow plan (`C:\Chanuth\hydra\models.json` + `docs/ORCHESTRATOR.md`): one orchestrator head plans, dispatches, audits, and merges; implementer heads build in isolated lanes; cheapest model that meets each lane's floor; backups on a different subscription.
**Target:** Chip working with fakes ≈ 2.5 h after Wave 0 starts; live with Backboard ≈ 3.25 h.
**Chip is built as a standalone module** (plain Node + TypeScript, no Electron) and tested in the terminal with `chip-cli`. **Hooking it into the app happens later, at the team integration checkpoint**, once the app shell exists (Lane J part 2).

---

## 1. The heads Melvin has (from Hydra's catalog, scores as of 2026-09-29)

| Engine | Model | Cross-vendor band | Best at here | Hydra role |
|---|---|---|---|---|
| Claude | **Opus 5.5** | frontier (87.7) | Design, integration, fragile logic, audits | **Orchestrator** (high; xhigh for Wave 0 contracts). Coding chain primary at *medium*. |
| Claude | **Sonnet 5.5** | strong (83.3) | Writing (prompts, copy), analysis | Writing/analysis chain primary |
| Codex | **GPT-6 Sol** | strong (79.2) | Coding from a tight spec | **Default implementer**; coding chain #2 at *high* |
| Codex | **GPT-6 Luna** | value (65.0) | Simple, well-specified modules | Extraction/simple chain primary |
| Codex | GPT-6 Astra | frontier (88.7) | Backup orchestrator | Only if Opus is rate-limited |
| AGY | **Gemini 3.8 Flash (High)** | value (73.9) | Tool use, UI-ish wiring, well-specified modules | Tool-use chain primary; coding chain #3 |

**Hydra rules that apply tonight:**
1. **AGY has nothing at strong or frontier.** It never gets a lane whose floor is strong (JobScheduler, Orchestrator).
2. **Escalate on demonstrated failure only, and escalate effort before band.** Example: Sol high → Sol xhigh → then Opus medium.
3. **Spread lanes across subscriptions** so one rate limit doesn't stall everything (Claude 2–3 sessions, Codex 3, AGY 2).
4. **Implementers never get MCP access** (they could send email from real accounts):
   - Codex: always `--ignore-user-config --disable apps`.
   - Claude and AGY lanes: run interactively, and **deny any MCP tool call** they ask for.
5. **Audit against the running code, not the report.** The orchestrator re-runs each lane's tests before merging.
6. **A STOP from an implementer means the spec is wrong or unclear.** Fix the spec; don't push the lane past it.
7. **Fragile code gets a cross-vendor review** before merge. Codex code is reviewed by Claude, and Claude code by Codex.

---

## 2. Waves at a glance

```
WAVE 0  (Opus, ~30 min) ── contracts + skeleton + lane specs ──────────────────────┐
                                                                                    ▼
WAVE 1  (all parallel, ~60–75 min)                                                 
  A  JobScheduler ............... Codex  GPT-6 Sol  high      (floor: strong)
  (B  Backboard client → moved to Shafeen, lane S1)
  C  Fakes + fake clock + history Codex  GPT-6 Luna medium    (floor: value)
  D  Prompt/tools/acks/parser ... Claude Sonnet 5.5 high      (floor: strong, writing)
  E  MoodEngine + Presence ...... AGY    Gemini 3.8 Flash High (floor: value)
  H  NudgeEngine + planner ...... AGY    Gemini 3.8 Flash High (floor: value)
        │  merge order: C → D → E → H → A   (audit each, ~25 min total)
        ▼
WAVE 2  (parallel, ~45–60 min)
  G  Orchestrator ............... Claude Opus 5.5 medium   (floor: frontier-ish; the integrator)
  I  chip-cli harness + C1–C18 .. Claude Sonnet 5.5 high   (floor: strong)
        │  cross-vendor review of G by Codex GPT-6 Sol high → merge G → merge I
        ▼
WAVE 3  (~30 min)
  J1 createChipCore() ........... Codex  GPT-6 Sol  medium   (one function that builds all of Chip)
  K  Live run (real Backboard) .. Orchestrator (Opus) + Melvin: chip-cli live, C1–C3 + free play
LATER — team integration checkpoint (once Shafeen's app shell exists)
  J2 Hook Chip into the app ..... Codex  GPT-6 Sol  medium   (~25 min)
```

**Why this split:**
- Wave 1 lanes only depend on the **interfaces** frozen in Wave 0, never on each other's code, so they truly run in parallel.
- The Orchestrator (G) is the only piece that touches everything, so it waits for Wave 1.

---

## 3. Wave 0 — Orchestrator setup (Opus 5.5, xhigh for contracts; ~30 min)

Melvin opens **one interactive Claude Code session (Opus 5.5)** at the repo root. That's the orchestrator for the whole build.

| Step | What | Done when |
|---|---|---|
| 0.1 | Look at what's already in the repo. Set up Chip's core as **plain TypeScript, no Electron** (`src/shared`, `src/main/...`, `tests/`, `scripts/`). If an app shell already exists, put the folders at the paths the docs expect inside it; if not, **don't create one** (that's Shafeen's job). | `npx tsc --noEmit` runs |
| 0.2 | Dev tooling: TypeScript strict, **vitest**, **tsx**, script `npm test` | `npm test` runs (0 tests OK) |
| 0.3 | **Contracts:** `src/shared/*` from `ARCHITECTURE.md §3` | `tsc --noEmit` passes |
| 0.4 | **Interfaces file:** `src/main/runtime/types.ts` with *every* interface in Chip spec §7, **including the sponsor plugs Shafeen implements** (`SendParams`, `LlmClient`, `AgentResult`, `SpecialistRunner`, `Job`, `JobScheduler`, `PresenceManager`, `Nudge`, `NudgeStore`, `NudgeEngine`, `CalendarSource`, `HistoryStore`, `EventSink`, `MemoryApi`, `Memory`, `TigerQueries`, `VoiceService`, `Clock`) + `OrchestratorDeps`. **Push this ASAP: Shafeen's lanes S1/S3/S5b wait on it.** | Compiles; pushed; Shafeen told |
| 0.5 | **EventBus** (`src/main/bus/eventBus.ts`, ~40 lines, Chip spec step 3) — small and everyone needs it, so the orchestrator writes it | Its unit test passes |
| 0.6 | **Clock interface** in `types.ts`: `now(): number; setTimeout(fn, ms): Handle; clearTimeout(h)` | Compiles |
| 0.7 | Write one **lane spec per lane** in `docs/lanes/CHIP-<X>.md` from §5 below (objective, owned paths, spec sections to read, steps, tests, STOP conditions) | 9 files |
| 0.8 | **Contracts + types.ts → quick PR into `main`** (Chanuth approves; Shafeen rebases on it). Then `git switch -c chip/logic` from the updated `main`, push, and create one worktree per Wave 1 lane: `git worktree add ../ade-wt-chip-logic-<x> -b lane/chip-logic-<x> chip/logic` | Contracts on `main`; 5 worktrees |

**Freeze rule:** after 0.8, `src/shared/*` and `src/main/runtime/types.ts` are **frozen on `main`**. A lane that needs a change STOPs and asks the orchestrator. Changes go through a PR into `main` (Chanuth approves), and both Melvin and Shafeen rebase.

---

## 4. Lane table

| Lane | Builds (Chip spec §) | Engine / model / effort | Floor | Backup (different subscription) | Owned paths (only these) | Est. |
|---|---|---|---|---|---|---|
| **A** | JobScheduler: queues, parallel, duplicates, help jobs, pause/resume clock, cancel (§3, §4.1, §8 job events) | Codex · GPT-6 Sol · **high** | strong | Claude Opus 5.5 medium | `src/main/runtime/jobs.ts`, `tests/jobs.test.ts` | 60 min |
| ~~B~~ | **Moved to Shafeen (S1).** Backboard client + 20-min spike (§7 `LlmClient`; `ARCHITECTURE §4.2`; retry rules §9 step 5) | Codex · GPT-6 Sol · **medium** | strong | Claude Sonnet 5.5 high | `src/main/runtime/backboard.ts`, `scripts/backboard-spike.ts`, `tests/backboard.test.ts` | 45 min |
| **C** | Fake brain, fake animals, stub Warden, fake calendar, fake clock (`advance(ms)`), in-memory HistoryStore (§5, §10.5) | Codex · GPT-6 Luna · **medium** | value | AGY Gemini 3.8 Flash High | `src/main/testing/*`, `src/main/runtime/clock.ts`, `src/main/runtime/history.ts`, `tests/fakes.test.ts`, `tests/history.test.ts` | 50 min |
| **D** | Chip system prompt, turn-input builders, tool schemas, acks, output parser (§10–13, §11 parsing) | Claude · Sonnet 5.5 · **high** | strong (writing) | Codex GPT-6 Sol medium | `src/main/agents/chipmunk/*`, `tests/chip-prompt.test.ts` | 45 min |
| **E** | MoodEngine + PresenceManager (§15, §4.2) | AGY · Gemini 3.8 Flash High | value | Codex GPT-6 Luna high | `src/main/runtime/mood.ts`, `src/main/runtime/presence.ts`, `tests/mood.test.ts`, `tests/presence.test.ts` | 60 min |
| **H** | NudgeEngine + nudge planner (§14) | AGY · Gemini 3.8 Flash High | value | Codex GPT-6 Sol medium | `src/main/runtime/nudges.ts`, `tests/nudges.test.ts` | 60 min |
| **G** | Orchestrator: inbox, turn loop, tool executors, result batching, stop/nudge handling, mood fallback, errors (§8, §9, §10 executors) | Claude · Opus 5.5 · **medium** | frontier-ish | Codex GPT-6 Sol high | `src/main/runtime/orchestrator.ts`, `tests/orchestrator.test.ts` | 60 min |
| **I** | `scripts/chip-cli.ts` (offline + live modes, `/ff`, `/nudge`) and scripted scenario tests C1–C18 (§19) | Claude · Sonnet 5.5 · **high** | strong | Codex GPT-6 Sol medium | `scripts/chip-cli.ts`, `tests/scenarios/*` | 50 min |
| **J1** | `createChipCore()`: one function that builds all of Chip; `chip-cli` uses it | Codex · GPT-6 Sol · **medium** | strong | Claude Sonnet 5.5 high | `src/main/chipCore.ts` | 15 min |
| **J2** *(at integration)* | Hook Chip into the app: IPC handlers, bus → renderer, preload `window.ade` | Codex · GPT-6 Sol · **medium** | strong | Claude Sonnet 5.5 high | `src/main/index.ts`, `src/preload/index.ts`, `src/main/ipc.ts` | 25 min |

**Subscription load:**
- **Claude:** Opus orchestrator + D (Wave 1) → G + I (Wave 2).
- **Codex:** A, C (Wave 1) → G's reviewer (Wave 2) → J1 (Wave 3) → J2 (integration).
- **AGY:** E, H (Wave 1).

If one subscription hits its limit, its lanes move to the backup column.

---

## 5. Lane specs (what each lane file `docs/lanes/CHIP-<X>.md` says)

Every lane file has the same six parts. The orchestrator fills them in from this section.

### Lane A — JobScheduler (Codex GPT-6 Sol high)
- **Read:** Chip spec §3, §4.1, §7 (`Job`, `JobScheduler`, `SpecialistRunner`), §8 rows "Job submitted/finishes/Help job".
- **Build:**
  1. Per-animal FIFO of normal jobs; different animals run concurrently.
  2. `submit()` statuses: `started` / `woke_and_started` (calls `presence.wake` first if docked) / `queued` (with position) / `duplicate` (normalized title: lowercase, trim, strip punctuation) / `not_installed`.
  3. **Help jobs** (`kind:'help'`) bypass the queue and run immediately. `waitFor(jobId)` resolves with the result.
  4. Safety timeout: 180 s normal / 60 s help, measured in **working time**. `pauseClock`/`resumeClock` stop and restart it.
  5. `cancel({agent})` / `cancel({all:true})` aborts running jobs (AbortController) and drops queued ones.
  6. Emits `job.update` (queued/running/done/failed/cancelled), `agent.handoff` on start, and on finish `agent.say(report)` then `agent.return`, in the §8 order.
  7. `onFinished` callbacks.
- **Inject:** bus, SpecialistRunner, PresenceManager, settings getter, Clock.
- **Tests (vitest, fake clock + fake runner):** parallel across animals (C3); queue position + run-after (C4); duplicate (C5); help bypass while the helper is busy, with no `ask_teammate` for help jobs (C7, using a flag on the ctx); cancel one animal (C8); auto-wake docked (C10); approval pause doesn't time out at 4 min (C11); timeout fires at 180 s working time.
- **STOP if:** the interfaces in `types.ts` can't express something you need.

### Lane B — MOVED to Shafeen (lane S1 in `01-chip-SPONSOR-LANES-SHAFEEN.md`). Kept below for reference only.
- **Read:** `ARCHITECTURE.md §4.2`, Chip spec §7 (`SendParams`, `LlmResponse`, `LlmClient`), §9 step 5 (retry).
- **Build:**
  1. `BackboardClient implements LlmClient` using `fetch`, base `https://app.backboard.io/api`, header `X-API-Key`.
  2. `send` → `POST /threads/messages` (JSON: `assistant_id, thread_id, content, system_prompt, tools, llm_provider, model_name, memory, web_search, json_output`).
  3. `submitToolOutputs` → `POST /threads/tool-outputs` `{thread_id, tool_outputs}`.
  4. Extras: `createAssistant`, `listModels` (`GET /models?model_type=llm&supports_tools=true`), `listMemories` (`GET /assistants/{id}/memories`).
  5. Timeout 25 s combined with the caller's signal (`AbortSignal.any`). Retry once on network error, timeout, or 5xx; never on 4xx or caller abort. Non-2xx throws with status + body.
- **Spike script:** create a test assistant → send with one dummy tool → submit its output → print both responses + the first 20 model names.
- **Tests:** mock `fetch`. Check the retry policy, that abort isn't retried, and the request body shape.
- **Needs from Melvin:** `BACKBOARD_API_KEY` in `.env` (never committed).
- **STOP if:** the real API response differs from the doc (e.g. no `status` field). Report the actual JSON.

### Lane C — Fakes, clock, in-memory history (Codex GPT-6 Luna medium)
- **Read:** Chip spec §5, §7, §10.5, §16.
- **Build:**
  1. `FakeClock` (`now`, `setTimeout`, `clearTimeout`, `advance(ms)` fires due timers in order) + `RealClock`.
  2. `FakeLlm` (a script: list of responses; records every request).
  3. `FakeSpecialists` (configurable delay; returns the §16 format parsed into `AgentResult`; can be told to call `ask_teammate`).
  4. `StubWardenGate` (deny `external`, allow the rest, emits `wolf.verdict`).
  5. `FakeCalendar` (3 events, one "Midterm" ending at now + 5 min).
  6. `MemoryHistoryStore` (4 query kinds over `bus.recent()`).
- **Tests:** FakeClock ordering; history queries return the right rows from a seeded bus.
- **STOP if:** none expected.

### Lane D — Chip prompt, tools, acks, parser (Claude Sonnet 5.5 high)
- **Read:** Chip spec §2, §10, §11, §12, §13.
- **Build:**
  1. `prompt.ts`: `CHIP_SYSTEM_PROMPT` (exact §11 text; names from `config.ts`), `buildContext(state)`, `buildUserTurn`, `buildResultTurn`, `buildNudgeTurn` (exact §12 formats).
  2. `tools.ts`: `chipTools(installedIds)` → the 5 schemas from §10, with enums filled in.
  3. `acks.ts`: `pickAck(agentId, status, userMood)` per the §13 table.
  4. `parse.ts`: `parseChipOutput(text) → { silent, bubble, speech }` per the §11 parsing rules.
- **Tests:** snapshot of the built turns against §12; enums exclude not-installed animals; acks give "On it." for angry/stressed; parser handles `(silent)`, a missing bubble line, and >3 sentences.

### Lane E — MoodEngine + PresenceManager (AGY Gemini 3.8 Flash High)
- **Read:** Chip spec §15, §4.2, §8 presence row.
- **Build:**
  1. `MoodEngine`: tables exactly as §15, contagion order, active-only, ≥0.3 threshold, change-only emits, decay from `settings.timers.moodDecaySec`, relief table, `getUserMood()`, `dispose()`.
  2. `PresenceManager`: per-animal idle timers from `settings.timers`, `touch`, sleep → dock transitions with `agent.presence` events, `wake(id, reason)` resolving within 3 s, Chip never docks, startup = active.
- **Inject:** bus, Clock, settings getter, `isInstalled`.
- **Tests:** C14, C15 timing with the fake clock; C9 sleep → dock; Chip never docks; touch resets timers.
- **AGY note:** run **interactively** in the worktree (`agy --model gemini-3.8-flash-high`), accept edits, **deny any MCP call**.

### Lane H — NudgeEngine + planner (AGY Gemini 3.8 Flash High)
- **Read:** Chip spec §14, §7 (`Nudge`, `NudgeEngine`, `CalendarSource`).
- **Build:**
  1. In-memory `NudgeStore` (interface in `types.ts`; Shafeen's S5b provides the Tiger version).
  2. `schedule` / `cancel` / `snooze` / `markAnswered` / `fireNextNow`.
  3. A 30 s check loop on the Clock. Manners: quiet hours, DND, "calm moment" hooks (`isUserBusy()` injected), max per hour with merging into batches.
  4. Rule nudges: daily (first open after quietEnd), evening 20:00, weekly Sunday 18:00.
  5. Planner: `calendar.listEvents(now, +7d)` → one `llm.send` (fresh thread, `memory:'off'`, `jsonOutput:true`) → dedupe by `eventId+kind` → schedule. Retry in 1 h on failure.
- **Tests:** C12 (midterm after-nudge fires), C13 (quiet hours hold), the rate limit merges into one batch, planner dedupe.

### Lane G — Orchestrator (Claude Opus 5.5 medium) — Wave 2
- **Read:** the whole Chip spec, focusing on §8, §9, §10 executors.
- **Build:**
  - `Orchestrator` with an inbox (user > results > nudges) and a Chip-turn lock.
  - The 9-step loop.
  - Tool executors wired to A/D/E/H/C.
  - Result batching (same `parentTaskId` within 1.5 s).
  - Stop check (≤ 4 words), nudge answered/snooze detection, mood fallback, the error table (`Dizzy` + foggy line).
- **Tests:** C1, C2, C6, C16, C17 with FakeLlm scripts.
- **Review:** before merge, Codex GPT-6 Sol (high) reviews the diff (cross-vendor).

### Lane I — chip-cli + scenario tests (Claude Sonnet 5.5 high) — Wave 2
- **Build:**
  - `scripts/chip-cli.ts`: offline mode (FakeLlm per scenario) and live mode (real Backboard + fake animals); colored timestamped event lines; `/ff 10m`, `/nudge`, `/scenario C7`.
  - `tests/scenarios/C1..C18.test.ts`, one per row of §19.
- Can start as soon as Wave 1 is merged, coding against `OrchestratorDeps`. Its scenarios go green when G merges.

### Lane J — Hook into the app (Codex GPT-6 Sol medium) — two parts
- **J1, Wave 3 (15 min):** `src/main/chipCore.ts` exports `createChipCore(config)`. It builds bus → clock → backboard → presence → jobs → mood → nudges → history → orchestrator and returns `{ bus, orchestrator, presence, nudges, dispose }`. `chip-cli` switches to it, so the app later gets the exact object that was tested.
- **J2, at the integration checkpoint (25 min, needs Shafeen's app shell):**
  - `main/index.ts` constructs: bus → clock → backboard → presence → jobs → mood → nudges → history → orchestrator.
  - IPC handlers per `ARCHITECTURE §3.4` (`sendMessage`, `sendVoice` (placeholder until Shafeen's STT), `wakeAgent`, `setDoNotDisturb`, `demoFireNudge`).
  - Bus → `webContents.send('ade:event')`; preload exposes `window.ade`.
- **Done when:** typing in a temporary test input shows Chip events in the DevTools console.

---

## 6. Dispatch commands (Windows PowerShell; adjust paths)

**Codex lane (headless, no MCP):**
```powershell
Set-Location ..\ade-wt-a
Get-Content -Raw ..\ade\docs\lanes\CHIP-A.md | codex exec - -m gpt-6-sol -c model_reasoning_effort="high" `
  --ignore-user-config --disable apps -C . --color never -o ..\lane-a-final.md
```
- If the sandbox errors on Windows (as it does on Chanuth's machine), add `-s danger-full-access`. It's safe here only because the lane runs inside its own worktree.
- **Never** paste the prompt as a quoted argument; always pipe it through stdin (Hydra's stdin rule).

**Claude lane (interactive):** open a terminal in the worktree → `claude --model sonnet` (or `opus`) → `/effort high` (or `medium`) → *"Read docs/lanes/CHIP-D.md and do exactly that lane. Run its tests. Stop and tell me if a STOP condition hits."* **Deny any MCP tool prompt.**

**AGY lane (interactive):** terminal in the worktree → `agy --model gemini-3.8-flash-high` → accept-edits mode → same instruction. **Deny any MCP tool prompt.**

---

## 7. Orchestrator's audit + merge (per lane)

1. **Re-run the lane's tests yourself** in its worktree. Don't trust "PASS" in the report.
2. Read fragile code (A, G, E's timers) for: writes outside owned paths, blocking calls, timers that never clear, unhandled promise rejections.
3. `git diff --stat chip/logic...lane/chip-logic-<x>`: only owned paths changed; no `.env` or keys.
4. **Cross-vendor review:** A (Codex) → reviewed by Opus; G (Claude) → reviewed by GPT-6 Sol.
5. Merge **one lane at a time into `chip/logic`**: **C → D → E → H → A**, then **G → I**, then **J1**. Run `npm test` on `chip/logic` after each merge, before pushing.
6. Push `chip/logic`; other lanes `git rebase chip/logic` if they need merged code. **Sponsor kit:** when Shafeen posts "ready", `git merge origin/chip/sponsors` into `chip/logic`.
6b. **Chip logic done** → PR `chip/logic → main`; Chanuth merges it at the integration checkpoint.
7. `git worktree remove ../ade-wt-<x>` after merge.

**Escalation on a failed lane:**
1. Retry on the same model with one effort notch up (Sol high → xhigh; Luna medium → high; AGY Flash High is already its top, so go to its backup).
2. Still failing → the backup column (different subscription).
3. Two failures there → the orchestrator re-reads the spec. It's probably the spec, not the model.

---

## 8. Timeline (starting when Melvin begins Wave 0)

| Clock | Milestone |
|---|---|
| +0:00 | Wave 0 starts (Opus) |
| +0:30 | Wave 0 merged + pushed (Shafeen notified); 5 worktrees; lanes A C D E H dispatched |
| +1:15 to +1:30 | Wave 1 lanes report; audits + merges (C→B→D→E→H→A) |
| +1:45 | Wave 2: G + I dispatched |
| +2:45 | G reviewed + merged, I merged → **all 18 scenarios green offline** |
| +2:45 | Wave 3: J1 dispatched; plug in **Shafeen's sponsor kit** (real Backboard, Tiger, voice); orchestrator + Melvin run **live** chip-cli (C1–C3 + free play) |
| +3:15 | **Chip core done**: `createChipCore()` tested offline and live, ready for the app and the real animals |
| Integration checkpoint | J2: hook into Shafeen's app shell (~25 min) |

---

## 9. What Melvin needs ready before Wave 0

- [ ] The repo cloned; Node 20+ (Electron's Node supports `AbortSignal.any`)
- [ ] `BACKBOARD_API_KEY` (for lane B's spike and the live run)
- [ ] Codex logged in; AGY logged in; Claude Code logged in
- [ ] This file + `01-chip-orchestrator.md` + `ARCHITECTURE.md` in the repo's `docs/`
