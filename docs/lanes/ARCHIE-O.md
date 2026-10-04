# ARCHIE-O — Organize, soft trash, and undo

**Engine:** Codex GPT-6 Sol, high. **Branch:** `lane/beaver-logic-o`.

## Objective

Implement Archie's reversible write tools: planning, approval-ready application, soft trash, seven-day sweep, and undo.

## Owned paths

- `src/main/agents/beaver/organizeTools.ts`
- `src/main/agents/beaver/planStore.ts`
- `tests/beaver-organize.test.ts`

## Read

- `docs/agents/02-archie-files.md` §§4.2, 5, 11, 16
- `docs/lanes/README.md`

## Build and test

1. Plan by type/date, validate proposed moves, and expire plans after 30 minutes.
2. Journal before every operation; use clash names, copy-verify-delete cross-volume moves, and throttled progress.
3. Make delete soft trash to `Documents/ADE Trash/<batch>`; sweep only batches older than seven days through injected `FsShell`.
4. Reverse batches safely, including trash restoration, swept-batch error handling, and empty-folder cleanup.
5. Cover A5–A10, A13, A17–A20. Obtain the required Opus review before merge.

## STOP

Stop for any ambiguous filesystem mutation, real path, missing Warden gate behavior, or contract mismatch.
