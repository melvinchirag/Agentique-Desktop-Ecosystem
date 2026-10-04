# Lane H: NudgeEngine and nudge planner (push-first Chip)

**Engine:** AGY · Gemini 3.8 Flash High · **Backup:** Codex GPT-6 Sol medium · **Floor:** value
**Branch:** `lane/chip-logic-h` · **First read:** `docs/lanes/README.md` (rules for every lane)

## Objective
Chip reaches out first: after an exam, at the evening wrap-up, on Sunday. This lane decides **what** to ask and **when it's polite** to ask.

## Owned paths (only these)
- `src/main/runtime/nudges.ts`
- `src/main/runtime/nudgeStore.ts`
- `tests/nudges.test.ts`

## Read
Chip spec: **§14** (all of it), **§7** (`Nudge`, `NudgeEngine`, `NudgeStore`, `CalendarSource`, `LlmClient`, `SendParams`), **§8** (nudge row). `src/main/runtime/types.ts`.

## Build

### `nudgeStore.ts`
```ts
export class MemoryNudgeStore implements NudgeStore { readonly all: Nudge[] }   // `all` for tests
```
`due(now)` = nudges with state `pending` or `snoozed` and `askAt <= now`, oldest first. `findByEvent(eventId, kind)` ignores `cancelled` ones. Store copies, not references.

### `nudges.ts`
```ts
export interface NudgeDeps {
  bus: Bus; clock: Clock; settings: () => AdeSettings;
  store: NudgeStore; calendar: CalendarSource; llm: LlmClient;
  chipAssistantId: string;
  isUserBusy: () => boolean;                 // true while the user holds Chip, during a Chip turn, or < 20 s after their last message
  isDoNotDisturb?: () => boolean;            // default () => false
  newId?: () => string;                      // default crypto.randomUUID
}
export function createNudgeEngine(deps: NudgeDeps): NudgeEngine;
export const CHECK_EVERY_MS = 30_000;
export const PLANNER_RETRY_MS = 60 * 60_000;
export const ANSWER_WINDOW_MS = 10 * 60_000;  // exported for the orchestrator (§9 step 2)
export function isQuietTime(at: Date, quietStart: string, quietEnd: string): boolean;   // handles ranges over midnight
export function buildPlannerPrompt(events: CalendarEvent[], now: Date): string;
```

**`start()`**
1. Start the check loop: every `CHECK_EVERY_MS` on the Clock (chain `setTimeout`s; no `setInterval`).
2. Schedule the **rule nudges** (source `'rule'`) that aren't already pending:
   - `daily`: if it's past `quietEnd` today and no daily nudge exists for today → ask now; else at today's `quietEnd`. Question: "Morning! Want the rundown for today?" · about `daily check-in`.
   - `evening`: today 20:00 (tomorrow if past). "Wrap-up time. How'd today go? Anything to move to tomorrow?" · about `evening wrap-up`.
   - `weekly`: next Sunday 18:00. "Big week ahead. Want a plan?" · about `weekly plan`.
   - When a rule nudge fires, schedule the next one of the same kind (tomorrow / next week).
3. Run the **planner** now, then again at the next local midnight, then every midnight.

**Planner** (§14.2):
1. `calendar.listEvents(now, now + 7 days)`. No events → done.
2. One `llm.send({ assistantId: chipAssistantId, content: buildPlannerPrompt(events, now), memory: 'off', jsonOutput: true })`, with **no `threadId`** (fresh thread) and no tools.
3. Parse `content` as JSON `{ "nudges": [{ "eventId", "kind": "before"|"after", "askAt", "question", "about" }] }`. Skip items with an unknown `eventId`, a bad `kind`, an unparseable `askAt`, or `askAt` in the past.
4. Drop items where `store.findByEvent(eventId, kind)` already exists; `schedule` the rest (source `'planner'`).
5. Any failure (throw, bad JSON) → try again in `PLANNER_RETRY_MS`. Rule nudges are unaffected.
`buildPlannerPrompt` writes the rules from §14.2 (important events only: exams, interviews, deadlines, presentations, games, trips, appointments; skip routine ones; `after` = 1–2 h after the end; `before` = the evening before or a few hours before), the events as JSON (`id`, `title`, `start`, `end` in ISO), the current time, and the exact output JSON shape.

**Check loop** (every 30 s), and also right after `fireNextNow()`:
1. `due = store.due(now)`. Nothing due → done.
2. **Hold** (fire nothing, try again next tick) when any is true: `settings().nudges.enabled` is false · quiet time (`isQuietTime`) · `isDoNotDisturb()` · `isUserBusy()` · rate limit reached.
3. **Rate limit:** at most `settings().nudges.maxPerHour` **batches** in any rolling 60 minutes. While limited, due nudges wait and go out together in the next allowed batch.
4. Otherwise fire **all** due nudges as one batch: each → state `fired` (store update), emit `nudge.fire` (`agentId: 'chipmunk'`, `nudgeId`, `kind`, `about`); then call every `onDue(batch)` callback (each in try/catch).

**Other methods**
- `schedule(n)` → new id, state `pending`, `store.insert`, returns the id. (The store is async; keep an in-memory copy so `schedule` can return synchronously.)
- `cancel(id)` → state `cancelled`. `markAnswered(id)` → `answered`.
- `snooze(id, minutes)` → state `snoozed`, `askAt = now + minutes`.
- `fireNextNow()` (demo hotkey): fire the **earliest pending or snoozed** nudge right away, **ignoring quiet hours, DND, busy, and the rate limit** (it still counts toward the rate limit). None → do nothing.
- `dispose()` clears every timer.

## Tests (`tests/nudges.test.ts`): FakeClock, MemoryNudgeStore, FakeLlm-style stub you write in the test (Lane C's FakeLlm isn't merged yet), a calendar stub, `makeTestSettings`
1. **C12:** a "CS 280 Midterm" event ends now + 5 min; the planner stub returns an `after` nudge at end + 1 h → after advancing 65 min + one check, `onDue` gets it and `nudge.fire` is emitted; the question text passes through.
2. **C13:** a nudge due at 23:30 local is held through the night and fires at the first check after 08:00.
3. **Rate limit:** 5 nudges that come due at 5 different times within one hour, `maxPerHour: 3` → only 3 batches in that hour; the 2 held ones come out together as one batch once the oldest batch is 60 min old.
4. Busy and DND hold, then release.
5. **Planner dedupe:** the same planner output twice → scheduled once. Planner throws → retried after 1 h; rule nudges still fire.
6. `snooze(id, 120)` → fires again 2 h later. `cancel` → never fires. `markAnswered` → state `answered`.
7. `fireNextNow()` at 02:00 (quiet hours) fires immediately.
8. Rule nudges: started at 09:00 → daily now, evening at 20:00, weekly next Sunday 18:00; after evening fires, the next evening is scheduled for tomorrow.
9. `isQuietTime` for 23:00–08:00 and for a same-day range (13:00–14:00).
10. Planner request: no `threadId`, `memory: 'off'`, `jsonOutput: true`, `assistantId` passed through.

## STOP if
The `NudgeEngine` or `NudgeStore` interface can't support a rule above.
