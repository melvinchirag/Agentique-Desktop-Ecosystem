# ARCHIE-F — Fixture sandbox and local journal

**Engine:** AGY Gemini 3.8 Flash High. **Branch:** `lane/beaver-logic-f`.

## Objective

Provide the only filesystem surface tests may touch and an append-only local undo journal.

## Owned paths

- `tests/fixtures/makeSandbox.ts`
- `src/main/connectors/fs/localJournal.ts`
- `tests/localJournal.test.ts`

## Read

- `docs/agents/02-archie-files.md` §§5 and 16
- `docs/lanes/README.md`

## Build and test

1. Generate the documented Desktop, Documents, Downloads, ADE Trash, fresh-file, executable, `.git`, outside-prefix, and symlink fixture cases under a supplied temporary directory.
2. Implement `FileOpsJournal` as append-only JSONL with restart-safe reads, batch operations, undo/sweep markers, recency, and old-trash selection.
3. Test persistence after constructing a new journal instance.

## STOP

If symlink creation is disallowed, skip only that fixture and report it. Never use real user paths.

**Audit status (Oct 4):** Implemented by Codex GPT-6 Luna (managed agent, AGY unavailable) at `fcdcaa5`; audited and merged into `beaver/logic`. Matches Archie spec §5 and `FileOpsJournal` in `types.ts`; tests write only to OS temp folders. Only the three owned paths changed.
