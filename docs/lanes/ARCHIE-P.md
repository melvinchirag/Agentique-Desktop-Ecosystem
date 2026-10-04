# ARCHIE-P — Safe paths and file index

**Engine:** Codex GPT-6 Sol, medium. **Branch:** `lane/beaver-logic-p`.

## Objective

Build Archie’s filesystem boundary: canonical allowed-root checking plus a capped, exclusion-aware file index and watcher.

## Owned paths

- `src/main/connectors/fs/safePath.ts`
- `src/main/connectors/fs/fileIndex.ts`
- `tests/safePath.test.ts`
- `tests/fileIndex.test.ts`

## Read

- `docs/agents/02-archie-files.md` §§2–3, 11, 16
- `docs/lanes/README.md`

## Build and test

1. Resolve and realpath inputs before checking component-safe allowed-root containment.
2. Reject UNC/device paths, ADS, reserved paths, escapes, prefix tricks, and symlink escapes.
3. Build async chunked indexing with caps, `.git` and ADE Trash exclusion, search ranking, update operations, and watcher updates.
4. Cover A1 plus search, extension/age ranking, watcher updates, and exclusions using the fixture only.

## STOP

Stop if a test requires a real user folder or platform behavior that the spec does not define.

**Audit status (Oct 4):** Implemented by Codex GPT-6 Sol medium (managed agent) at `7200646`; audited and merged. `safePath` checked against the escape cases (prefix, symlink/junction, UNC/device, ADS, reserved and trailing-dot names). Audit fixes in `fileIndex.ts`: a folder change now re-scans only its subtree (the old code ran a full `build()`, emptying the index and flipping `isReady` during search); watcher `error` handler added (unhandled, it crashes the process when a watched folder is deleted on Windows); the initial scan no longer re-runs `safePath` per file. Two tests added.
