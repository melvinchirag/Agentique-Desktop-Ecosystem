# PIXEL-SP-PM1 — Pixel memory
**Branch:** `pixel/sponsors` · **Plan:** `docs/agents/04-pixel-SPONSOR-LANES-SHAFEEN.md` · **Spec:** `docs/agents/04-pixel-workspace.md` §5.2, §6.4, §10, §11
**Engine:** Claude Opus (the orchestrator built it; Codex and AGY were not used)

## Objective
Rules from spec §10 (task text only); Pixel's assistant recreated; MemoryWriter shape; deleteThread.

## Owned paths
src/main/agents/workspace/memory-rules.ts, src/main/sponsors/backboardMemory.ts, src/main/runtime/backboard.ts (deleteThread), scripts/pixel-memory-check.ts, tests/pixelMemory.test.ts

## Done when
The lane's tests pass, Chip's, Archie's, and Warden's sponsor tests still pass (`npm test`), and `npx tsx scripts/pixel-smoke.ts` passes.

## Rules
Never edit `src/shared` or `types.ts`. No keys or connection strings in commits. No text from a real mailbox in any committed file or fixture.
