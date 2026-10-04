# ARCHIE-SP-B1 — Backboard thread documents
**Branch:** `beaver/sponsors` · **Plan:** `docs/agents/02-archie-SPONSOR-LANES-SHAFEEN.md` · **Spec:** `docs/agents/02-archie-files.md` §4.1, §5, §7
**Engine:** Claude Opus (the orchestrator built it; Codex was not used) · **Contracts:** `FileOpsJournal`, `FileOp`, `DocumentsApi` from PRs #11 and #12

## Objective
BackboardDocuments implements DocumentsApi: uploadToThread (multipart, type and 20 MB checks), waitIndexed (poll every 1 s, at most 60 s).

## Owned paths
src/main/sponsors/backboardDocuments.ts, tests/backboardDocuments.test.ts, src/main/agents/beaver/memory-rules.ts (confirmed against spec §7)

## Done when
The lane's tests pass, Chip's sponsor tests still pass (`npm test`), and `npx tsx scripts/archie-smoke.ts` passes.

## Rules
Never edit `src/shared` or `types.ts`. No keys or connection strings in commits. Files are uploaded to the job thread, never to the assistant.
