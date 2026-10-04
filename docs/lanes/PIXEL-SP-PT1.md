# PIXEL-SP-PT1 — Tiger for Pixel
**Branch:** `pixel/sponsors` · **Plan:** `docs/agents/04-pixel-SPONSOR-LANES-SHAFEEN.md` · **Spec:** `docs/agents/04-pixel-workspace.md` §5.2, §6.4, §10, §11
**Engine:** Claude Opus (the orchestrator built it; Codex and AGY were not used)

## Objective
TigerDraftsLog over drafts_log: upsert on gmail_draft_id, setState, waiting; pulse().pixel; never throws; drops body-like subjects.

## Owned paths
scripts/tiger-schema.sql, src/main/store/tigerDrafts.ts, src/main/store/tigerQueries.ts (pulse().pixel), tests/tigerDrafts.test.ts

## Done when
The lane's tests pass, Chip's, Archie's, and Warden's sponsor tests still pass (`npm test`), and `npx tsx scripts/pixel-smoke.ts` passes.

## Rules
Never edit `src/shared` or `types.ts`. No keys or connection strings in commits. No text from a real mailbox in any committed file or fixture.
