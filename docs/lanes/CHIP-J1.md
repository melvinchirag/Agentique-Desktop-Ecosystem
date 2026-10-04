# Lane J1: `createChipCore()`

**Engine:** Claude · Sonnet 5.5 · high (the plan's backup; Codex can't write on Windows) · **Floor:** strong
**Branch:** `lane/chip-logic-j1` · **First read:** `docs/lanes/README.md` (rules for every lane)

## Objective
One function that builds all of Chip, so the app (app shell spec §15 / §18: `RealCore` wraps `createChipCore()`) gets **exactly the object the tests exercise**. Today `src/main/testing/offlineChip.ts` does the wiring by hand; after this lane it is a thin wrapper around `createChipCore()`, and every existing test still passes unchanged.

## Owned paths (only these)
- `src/main/chipCore.ts` (new)
- `tests/chipCore.test.ts` (new)
- `src/main/testing/offlineChip.ts` (refactor only; its exported API must not change)

## Read
`src/main/testing/offlineChip.ts` (the wiring to move), `src/main/runtime/types.ts`, Chip spec **§14.4** (nudge manners), `docs/agents/01-chip-BUILD-LANES.md` lane J, `docs/app-shell/00-APP-SHELL-SPEC.md` §15 and §18 (how the app will use it).

## Build: `src/main/chipCore.ts`
```ts
export interface ChipCoreConfig {
  llm: LlmClient;                    // Chip's brain: BackboardClient (live) or FakeLlm (tests)
  plannerLlm?: LlmClient;            // the nudge planner's client; default: `llm`
  runner: SpecialistRunner;          // FakeSpecialists today; the real AgentRuntime later
  calendar: CalendarSource;          // FakeCalendar today; Pixel's Google connector later
  settings: () => AdeSettings;
  chipAssistantId: string;
  clock?: Clock;                     // default new RealClock()
  sessionId?: string;                // passed to the EventBus
  nudgeStore?: NudgeStore;           // default new MemoryNudgeStore()   (Tiger: Shafeen's TigerNudgeStore)
  history?: HistoryStore;            // default new MemoryHistoryStore() (Tiger: TigerHistoryStore)
  eventSink?: EventSink;             // optional; subscribed to the bus (Tiger: TigerEventSink)
  timeZone?: string;                 // default: the system zone
  startNudges?: boolean;             // default true
}
export interface ChipCore {
  bus: EventBus; clock: Clock;
  jobs: JobScheduler; presence: PresenceManager; mood: MoodEngine;
  nudges: NudgeEngine; nudgeStore: NudgeStore; history: HistoryStore; orchestrator: Orchestrator;
  /** Hold-to-talk on Chip / the Hub mic (§14.4: no nudges while the user is holding Chip). */
  setUserTalking(on: boolean): void;
  /** Agent Hub do-not-disturb toggle (AdeApi.setDoNotDisturb). */
  setDoNotDisturb(on: boolean): void;
  isUserBusy(): boolean;
  /** Stops every engine and timer, unsubscribes, then flushes the event sink (if any). Safe to call twice. */
  dispose(): Promise<void>;
}
export const USER_BUSY_AFTER_MESSAGE_MS = 20_000;
export function createChipCore(config: ChipCoreConfig): ChipCore;
```
**Wiring order** (same as `offlineChip` today): bus → (eventSink subscription) → presence → jobs → mood → nudge store + engine → history → orchestrator → `presence.start()` → `nudges.start()` unless `startNudges === false`.
- **`isUserBusy()`** = user is talking (`setUserTalking`) **or** a Chip turn is running (Chip's `agent.status` `listening`/`thinking` until `idle`/`error`, tracked from the bus) **or** the last `user.message` was less than `USER_BUSY_AFTER_MESSAGE_MS` ago. The nudge engine gets this function.
- **`setDoNotDisturb`** feeds the nudge engine's `isDoNotDisturb`.
- **eventSink:** `bus.subscribe((e) => sink.enqueue(e))`. A throwing sink must not break the bus (the bus already isolates subscribers; don't add a second layer).
- **`dispose()`:** orchestrator → nudges → mood → presence → unsubscribe everything → `await eventSink?.flush()` (catch and log a flush error; never throw). A second call resolves immediately.

## Refactor: `src/main/testing/offlineChip.ts`
Keep `OfflineChipOptions`, `OfflineChip` and `buildOfflineChip` **exactly** as exported today (scenario tests and chip-cli depend on them). Inside, build the stack with `createChipCore()` (fakes as config, the existing `noNudgesPlanner` as `plannerLlm`, placeholder assistant id) and map its fields. `OfflineChip.dispose()` stays synchronous for its callers: call `void core.dispose()`.

## Tests: `tests/chipCore.test.ts` (FakeClock, FakeLlm, FakeSpecialists, FakeCalendar)
1. Builds and runs: `submitUserMessage('hi')` with a scripted FakeLlm → Chip speaks; the events reach the bus.
2. Defaults: no `nudgeStore`/`history` given → in-memory ones are used and exposed.
3. `plannerLlm` defaults to `llm`; when given, the planner uses it and Chip's script is untouched.
4. **eventSink:** every bus event is enqueued in order; `dispose()` awaits `flush()` once; a flush that rejects doesn't make `dispose()` reject.
5. `isUserBusy`: true while talking; true during a Chip turn; true for 20 s after a user message, false after; false otherwise.
6. **DND:** with `setDoNotDisturb(true)` a due nudge is held; after `false` it fires at the next check.
7. `startNudges: false` → no rule nudges scheduled.
8. `dispose()` twice is safe; after dispose, advancing the clock emits nothing.
9. The whole existing suite (193 tests incl. the 19 scenarios) still passes with the refactored `offlineChip`.

## Done when
All of the above, `npx tsc --noEmit` clean, `npm test` green.

## STOP if
Keeping `offlineChip`'s exported API identical is impossible, or an engine needs a dependency `ChipCoreConfig` can't provide.
