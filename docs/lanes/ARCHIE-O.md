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

## Orchestrator clarifications (Oct 4, after F + P + D + R merged)
- **Engine actually used:** Claude Opus 5.5 high (Codex's Windows sandbox can't write files, and Codex's usage limit was hit). The required "Opus review before merge" is still done, by a separate read-only Opus session.
- **Already on your branch, use it:** `safePath`/`isExcludedPath` and `FileIndex` (`src/main/connectors/fs/`), `LocalFileOpsJournal` and the `FileOpsJournal`/`FileOp` types, `tests/fixtures/makeSandbox.ts`, Archie's schemas `BEAVER_SCHEMAS`/`BEAVER_RISKS` and `BeaverBindings` (`src/main/agents/beaver/`), and the shared `FsShell` (`src/main/connectors/fs/fsShell.ts`) with `FakeFsShell` (`src/main/testing/fakeFsShell.ts`). Do not redefine them.
- **Shape:** export `createOrganizeToolBindings(deps): BeaverBindings` for exactly these 8 tools: `fs_plan_organize, fs_propose_plan, fs_apply_plan, fs_move, fs_rename, fs_mkdir, fs_trash, fs_undo`, plus `sweepOldTrash(deps)` for the seven-day sweep (called at app start, injected `FsShell.trashItem` only). `deps` = `{ safe: SafePathOptions, index: FileIndex, journal: FileOpsJournal, shell: FsShell, clock: Clock, newId?: () => string }`. Do not touch the read tools (lane T owns them) or `index.ts`.
- **Every write tool provides `preview`** (spec §4 table text) and `riskFor` where the table says W6 escalates (more than 25 files). Warden's `inspect` hook is added later by the Warden lane; don't add it.
- **Soft trash only.** Never `fs.rm` or `unlink` a user file. "Delete" = move into `Documents/ADE Trash/<batchId>/`, journaled, undoable; the sweep is the only thing that ever calls `shell.trashItem`.
- **Journal first.** Record the intent in the journal before each operation; a crash mid-batch must leave an undoable batch.
- **No real folders, ever.** Every test builds `makeSandbox(<os temp dir>)` and removes it afterwards; use `FakeClock` for the 30-minute plan expiry and the seven-day sweep.
- **Do not commit, push or merge.** Leave changes uncommitted; the orchestrator audits and commits.
