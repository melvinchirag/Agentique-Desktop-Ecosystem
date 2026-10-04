# Lane I: chip-cli and scenario tests C1–C19

**Engine:** Claude · Sonnet 5.5 · high · **Backup:** Codex GPT-6 Sol medium · **Floor:** strong
**Branch:** `lane/chip-logic-i` · **First read:** `docs/lanes/README.md` (rules for every lane)
**Starts after** lane G (orchestrator) is merged into `chip/logic`, so every scenario runs against real code.

## Objective
1. A terminal harness to chat with Chip and watch every event. Offline it uses fakes; live it uses real Backboard + fake animals.
2. One scripted test per scenario in Chip spec §19 (C1–C19), all green offline.

## Owned paths (only these)
- `scripts/chip-cli.ts`
- `src/main/testing/offlineChip.ts` (the offline stack builder)
- `tests/scenarios/*`

## Read
Chip spec **§18** (example timeline), **§19** (scenarios), **§17 step 13**. The code in `src/main/runtime/*`, `src/main/agents/chipmunk/*`, `src/main/testing/*`.

## Build

### `src/main/testing/offlineChip.ts`
```ts
export interface OfflineChipOptions {
  clock?: FakeClock | RealClock;               // default new FakeClock()
  llm?: LlmClient;                             // default new FakeLlm([])
  specialists?: FakeSpecialists;               // default new FakeSpecialists({ clock })
  settings?: AdeSettings;                      // default makeTestSettings()
  calendar?: CalendarSource;                   // default new FakeCalendar(clock)
  timeZone?: string;                           // default 'America/Detroit'
}
export interface OfflineChip {
  bus: EventBus; clock: Clock; llm: LlmClient; specialists: FakeSpecialists;
  jobs: JobScheduler; presence: PresenceManager; mood: MoodEngine; nudges: NudgeEngine;
  nudgeStore: MemoryNudgeStore; history: HistoryStore; orchestrator: Orchestrator;
  settings: () => AdeSettings; setSettings(patch: Partial<AdeSettings>): void;
  events(): BiomeEvent[];                      // bus.recent()
  dispose(): void;
}
export function buildOfflineChip(opts?: OfflineChipOptions): OfflineChip;
```
Wiring order: bus → presence → jobs (runner = specialists) → mood → nudge store + engine (`isUserBusy` = a Chip turn is running or the last `user.message` was < 20 s ago, tracked from the bus) → history → orchestrator. Calls `presence.start()` and `nudges.start()`. (Lane J1 later turns this into `createChipCore()`.)

### `scripts/chip-cli.ts` (run with `npx tsx scripts/chip-cli.ts [--live] [--demo]`)
- Reads lines from stdin. Prints every bus event as one colored line: `+12.4s  agent.say      chipmunk  "Scout, fly!"  [Scout 🦅] (ack)`. Times are relative to start.
- Commands: `/ff 10m` (or `30s`, `2h`) fast-forward the FakeClock (offline only); `/nudge` → `nudges.fireNextNow()`; `/jobs` → print `jobs.list()`; `/presence`; `/scenario C7` → run that scenario's script and print its events; `/quit`.
- **Offline (default):** `buildOfflineChip()` with a scripted `FakeLlm` that answers small talk, delegates on keywords (`email` → workspace, `file` → beaver, `find`/`search` → eagle, `plan` → ants), and summarizes results. Enough to demo the flow without any key.
- **`--live`:** real Backboard. Import the client **dynamically** from `src/main/runtime/backboard.ts` (Shafeen's S1; if the file doesn't exist yet, print "Backboard client not merged yet (sponsor kit)" and exit 1). Read `BACKBOARD_API_KEY` and `BB_ASSISTANT_CHIPMUNK` from `process.env` (load `.env` with `node:fs` + a tiny parser; never print values). Uses `RealClock` and fake animals.
- **`--demo`:** demo timers (`DEMO_TIMERS`).
- Ctrl+C / `/quit` → `dispose()` and exit 0.

### `tests/scenarios/`
One file per row of §19: `C01-small-talk.test.ts` … `C19-swarm-plan.test.ts`. Each builds `buildOfflineChip()` with a `FakeLlm` script, drives it, and asserts on events. A shared `tests/scenarios/helpers.ts` (event filters, `say(…)` matchers, script builders) is fine.
- Match the **Expected** column of §19 exactly. Where a scenario needs a specific behaviour (C7 help jobs, C11 approval pause), use `FakeSpecialists` behaviors and `jobs.pauseClock`/`resumeClock` directly.
- **C19:** first delegate goes to `ants` with title starting `Plan:`; after its result, Chip delegates steps 1–3 (beaver, eagle, workspace) with `plan_step` 1–3, each `agent.handoff` has `via: 'ants'`.
- All scenarios use the FakeClock; the whole folder runs in a few seconds.

## Done when
`npm test` is green including all 19 scenarios; `npx tsx scripts/chip-cli.ts` starts offline, `hi` gets a spoken reply, `check my email` shows ack → Pixel job → report → Chip summary after `/ff 10s`.

## STOP if
A scenario's expected behaviour in §19 can't be produced by the merged code. That's a bug in an earlier lane: report which lane and how it differs; don't patch other lanes' files.
