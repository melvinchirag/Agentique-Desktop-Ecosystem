# WARDEN-J: InjectionScreen

**Branch:** `lane/warden-logic-j`. **Read first:** `docs/lanes/WARDEN-COMMON.md`.

## Owned paths (only these)
- `src/main/wolf/injection.ts`
- `tests/warden-injection.test.ts`

## Build
`createInjectionScreen(deps): InjectionScreen` (spec sections 6 and 13).
1. Normalize: zero-width characters, Unicode tag characters, escape any `<untrusted` or `</untrusted` breakout.
2. Weighted heuristics, then a score, then flagged or borderline.
3. Optional injected `classifier` for borderline text only (3 second timeout, fail-safe, a fake in tests).
4. Return `wrapped`.
5. On a flag emit `wolf.alert` once per task + source and call the injected `onFlag(taskId)` (the taint callback).
Never put the raw text in an event.

## Tests (`tests/warden-injection.test.ts`)
- W-21: the corpus. Lane X's `tests/fixtures/warden/injection` and `benign` may not exist on your branch yet: build a small inline corpus yourself (malicious scores 0.6 or more, benign under 0.3), and also run the fixture files if they are present.
- W-22 breakout escaping; classifier fallback on timeout and on error; the alert and the taint callback fire once per task + source; a helper that replaces a flagged specialist `say`.

## STOP
If the benign false-positive set cannot stay under 0.3 without missing the malicious fixtures. Report the conflicting samples.
