# WARDEN-L: voice lines and speaker

**Branch:** `lane/warden-logic-l`. **Read first:** `docs/lanes/WARDEN-COMMON.md`.

## Owned paths (only these)
- `src/main/wolf/lines.ts`
- `src/main/wolf/speaker.ts`
- `tests/warden-lines.test.ts`

## Build
Spec sections 1, 7 and 9; Chip spec section 4.4 (speech priorities).
- `WARDEN_LINES`: trigger to `{ text, bubble, priority, sfx?, clip }`, priorities exactly as section 7 (warden vs report). `lineFor(decision | outcome | alert)`, `allWardenLines()` (Shafeen pre-generates audio from it), a 10 second throttle on the injected Clock.
- `WardenSpeaker`: subscribes to `wolf.verdict`, `approval.resolve` and `wolf.alert` on the bus; emits `agent.say` from `'wolf'`; silent on allow.

## Tests (`tests/warden-lines.test.ts`)
Every rule id that has a deny or ask path has a line; priorities match section 7; the throttle works on the fake clock; allow emits nothing; the speaker emits `agent.say` with `agentId: 'wolf'`.

## STOP
If section 7 does not define a line a rule needs.
