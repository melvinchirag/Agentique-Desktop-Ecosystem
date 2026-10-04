# Lane E: MoodEngine and PresenceManager

**Engine:** AGY · Gemini 3.8 Flash High · **Backup:** Codex GPT-6 Luna high · **Floor:** value
**Branch:** `lane/chip-logic-e` · **First read:** `docs/lanes/README.md` (rules for every lane)

## Objective
Two timer-driven engines: **"the biome reacts"** (mood) and **sleep → dock → wake** (presence).

## Owned paths (only these)
- `src/main/runtime/mood.ts`
- `src/main/runtime/presence.ts`
- `tests/mood.test.ts`
- `tests/presence.test.ts`

## Read
Chip spec: **§15** (MoodEngine, both tables), **§4.2** (presence), **§8** (presence row). `src/main/runtime/types.ts` (`MoodEngine`, `PresenceManager`).

---

## Part 1: `presence.ts`
```ts
export interface PresenceDeps { bus: Bus; clock: Clock; settings: () => AdeSettings }
export function createPresenceManager(deps: PresenceDeps): PresenceManager;
export const WAKE_FROM_DOCK_MS = 1500;    // time for the walk/fly back from the Hub
```
- Animals that aren't installed (`settings().installed[id] === false`) are `not_installed`, emit nothing, and ignore every call.
- **`start()`**: each installed animal → `active`, emit `agent.presence(active, 'startup')`, arm its sleep timer.
- **Sleep timer** (`timers.sleepAfterSec`): fires → `sleeping`, emit `agent.presence(sleeping, 'idle_timeout')`, arm the dock timer.
- **Dock timer** (`timers.dockAfterSec`, counted from falling asleep): fires → `docked`, emit `agent.presence(docked, 'dock_timeout')`.
- **Chip (`chipmunk`) sleeps but never docks**: no dock timer for Chip.
- **`touch(id)`**: if `active`, restart the sleep timer. If sleeping or docked, do nothing (waking is `wake()`'s job).
- **`setBusy(id, busy)`**: busy → clear the animal's timers (it can't fall asleep mid-job). Not busy → restart the sleep timer if `active`. Calls can repeat; keep a counter so two overlapping jobs need two `setBusy(false)` calls.
- **`wake(id, reason)`**:
  - `active` → resolve immediately, no event (but restart the sleep timer unless busy).
  - `sleeping` → `active`, emit `agent.presence(active, reason)`, resolve immediately.
  - `docked` → emit `agent.presence(active, reason)`, then resolve after `WAKE_FROM_DOCK_MS` on the Clock.
  - Two `wake()` calls while returning from the dock share one return (same promise, one event).
- **`onChange(cb)`**: called on every presence change, after the event is emitted.
- Read timers from `settings()` each time you arm a timer (settings can change at runtime, e.g. demo mode).
- **`dispose()`**: clear every timer.

## Part 2: `mood.ts`
```ts
export interface MoodDeps { bus: Bus; clock: Clock; settings: () => AdeSettings; presence: PresenceManager }
export function createMoodEngine(deps: MoodDeps): MoodEngine;
export const CONTAGION_DELAY_MS = 400;
export const CONTAGION_STAGGER_MS = 250;
export const CONTAGION_ORDER: AgentId[] = ['workspace','wolf','beaver','eagle','ants','butterfly','nightingale'];
```
`onUserMood(mood, intensity, reason, taskId?)` (the caller already emitted `user.mood`):
1. Cancel any pending contagion and decay timers.
2. **Relief check:** the new mood is `calm` or `happy` and the previous user mood was `angry` or `stressed` → use the relief table (Chip `relieved`, Warden `proud`, everyone else `happy`). Otherwise use the normal table (§15, copy it exactly, including the Iris/Celene column).
3. **Chip** gets its mood now (`cause: 'user'`), even when asleep.
4. **Contagion** if `intensity >= 0.3` **or this is a relief**: after `CONTAGION_DELAY_MS`, then every `CONTAGION_STAGGER_MS`, each animal in `CONTAGION_ORDER` that is installed and `presence.get(id) === 'active'` gets its mood (`cause: 'chipmunk'`). Check presence when its turn comes, not up front. The stagger counts only animals that actually react (no gaps for sleeping ones).
5. **Emit only when that animal's mood actually changes.** `agent.mood` carries `intensity` (the user's) and `taskId`.
6. **Decay:** `timers.moodDecaySec` after this call, every animal whose mood isn't `neutral` → `neutral` (emit, `cause: 'user'`), all at the same moment.
7. Remember the user mood: `getUserMood()` returns it (starts `calm`).

*Orchestrator clarification:* relief always spreads regardless of intensity, so test C15 ("ok thanks, that's better", usually a low-intensity calm) shows everyone happy.

`dispose()` clears all timers.

---

## Tests
**`tests/presence.test.ts`** (FakeClock, `makeTestSettings`, real `EventBus`):
1. `start()` emits `active/startup` for the 6 installed core animals only.
2. **C9:** with `DEMO_TIMERS`: 30 s → `sleeping` (not at 29.999 s); 60 s more → `docked`.
3. Chip goes `sleeping` but never `docked`, even after an hour.
4. `touch` at 20 s pushes sleep back to 50 s.
5. `setBusy(true)` holds the animal awake for 10 minutes; after `setBusy(false)` it sleeps 30 s later. Two overlapping busy calls need two releases.
6. `wake` from sleeping resolves at once; from docked it resolves only after 1500 ms; one event; concurrent wakes share it.
7. Not-installed animals (`butterfly`) are `not_installed` and ignore calls.

**`tests/mood.test.ts`** (FakeClock, a fake PresenceManager where you set each animal's presence):
1. **C14:** `angry` 0.9 → Chip `scared` at once; at 400 ms Pixel `nervous`, at 650 ms Warden `protective`, at 900 ms Archie `scared`… exactly the §15 row; at 20 s everyone back to `neutral`.
2. Only `active` animals catch it; a sleeping Scout is skipped and the stagger closes the gap.
3. Intensity 0.2 → Chip only, no contagion.
4. **C15:** `angry` then `calm` 0.2 a moment later → Chip `relieved`, Warden `proud`, others `happy`; the angry contagion still pending is cancelled.
5. Same mood twice → no duplicate `agent.mood` events.
6. `getUserMood()` follows the last call; starts `calm`.
7. A new mood before decay restarts the 20 s decay clock.

## STOP if
The §15 table and §4.2 disagree with this file in a way you can't resolve.
