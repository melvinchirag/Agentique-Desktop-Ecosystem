# ARCHIE-SP-T1 — Tiger file-ops journal
**Branch:** `beaver/sponsors` · **Plan:** `docs/agents/02-archie-SPONSOR-LANES-SHAFEEN.md` · **Spec:** `docs/agents/02-archie-files.md` §4.1, §5, §7
**Engine:** Claude Opus (the orchestrator built it; Codex was not used) · **Contracts:** `FileOpsJournal`, `FileOp`, `DocumentsApi` from PRs #11 and #12

## Objective
TigerFileOpsJournal implements FileOpsJournal over file_ops; adds the swept column; agent_activity for beaver counts file operations. The copy, not the source of truth. Never throws.

## Owned paths
src/main/store/tigerFileOps.ts, tests/tigerFileOps.test.ts, scripts/tiger-schema.sql (file_ops columns), src/main/store/tigerHistory.ts (agent_activity add-on)

## Done when
The lane's tests pass, Chip's sponsor tests still pass (`npm test`), and `npx tsx scripts/archie-smoke.ts` passes.

## Rules
Never edit `src/shared` or `types.ts`. No keys or connection strings in commits. Files are uploaded to the job thread, never to the assistant.
