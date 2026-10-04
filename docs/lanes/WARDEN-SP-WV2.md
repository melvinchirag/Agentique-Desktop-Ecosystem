# WARDEN-SP-WV2 — Voice service rule
**Branch:** `warden/sponsors` · **Plan:** `docs/agents/03-warden-SPONSOR-LANES-SHAFEEN.md` · **Spec:** `docs/agents/03-warden-security.md` §6.3, §7, §8, §10
**Engine:** Claude Opus (the orchestrator built it; Codex and AGY were not used)

## Objective
speak('wolf') ignores mood, serves shipped mp3s first, then cache, then live [serious].

## Owned paths
src/main/voice/elevenlabs.ts (wolf branch), src/main/voice/cache.ts (lookup), tests/voice-wolf.test.ts

## Done when
The lane's tests pass, Chip's and Archie's sponsor tests still pass (`npm test`), and `npx tsx scripts/warden-smoke.ts` passes.

## Rules
Never edit `src/shared` or `types.ts`. Warden's Backboard calls always use `memory: 'off'`. No keys or connection strings in commits.
