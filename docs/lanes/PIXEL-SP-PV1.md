# PIXEL-SP-PV1 — Voice + sounds
**Branch:** `pixel/sponsors` · **Plan:** `docs/agents/04-pixel-SPONSOR-LANES-SHAFEEN.md` · **Spec:** `docs/agents/04-pixel-workspace.md` §5.2, §6.4, §10, §11
**Engine:** Claude Opus (the orchestrator built it; Codex and AGY were not used)

## Objective
Voice previews for the team to pick; workspace.typing-loop and workspace.paper-shuffle; stock lines pre-generated into the voice cache.

## Owned paths
voices/previews/workspace-*, resources/sfx/workspace/**, resources/sfx/manifest.json, scripts/design-voices.ts, scripts/generate-sfx.ts

## Done when
The lane's tests pass, Chip's, Archie's, and Warden's sponsor tests still pass (`npm test`), and `npx tsx scripts/pixel-smoke.ts` passes.

## Rules
Never edit `src/shared` or `types.ts`. No keys or connection strings in commits. No text from a real mailbox in any committed file or fixture.
