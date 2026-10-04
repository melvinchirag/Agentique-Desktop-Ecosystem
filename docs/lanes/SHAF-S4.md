# SHAF-S4 — Sound effects + biome ambience (+ Celene music test)
**Branch:** `lane/chip-sponsors-s4` · **Spec:** `docs/SPONSORS.md` §3.4 · **Engine:** Claude (orchestrator runs it; AGY not available)

## Objective
Generate every sound in `SPONSORS.md` §3.4 once and ship them as files with a manifest.

## Owned paths
`scripts/generate-sfx.ts`, `resources/sfx/**`, `resources/sfx/manifest.json`, `resources/music/test-calm.mp3`

## Steps
1. One prompt per sound, `POST /v1/sound-generation` with `model_id: 'eleven_text_to_sound_v2'`, short explicit durations.
2. Save `resources/sfx/<group>/<name>.mp3`; write `manifest.json` entries `{ id, file, durationMs, prompt }`.
3. Groups: chip, warden, archie, scout, swarm, pixel, iris, celene, system, biome (list in §3.4).
4. Biome ambience: forest loop 20–30 s (`loop: true` if supported; otherwise note that the renderer crossfades).
5. Celene test: plan is paid (Creator) → one 20 s `POST /v1/music/compose` (`music_v2_5`) calm track → `resources/music/test-calm.mp3`.
6. Idempotent: skip files that exist unless `--force`; `--only <group>` supported.

## Tests / done when
Manifest lists all ~35 sounds, every file exists and is non-empty; Shafeen spot-checks 10.

## STOP if
The model id or endpoint is rejected, or credits run low (report remaining credits before continuing).

## Rules for every lane
- Touch ONLY the owned paths below. Never edit `src/shared/*` or `src/main/runtime/types.ts`.
- Never print, log, or commit key values, `.env`, or connection strings. Read secrets from `.env` at the repo root (`BACKBOARD_API_KEY`, `ELEVENLABS_API_KEY`, `TIGER_DATABASE_URL`).
- Plain TypeScript, Node 22+, ES modules, runnable with `npx tsx <file>`. Use built-in `fetch`; no vendor SDKs. Only extra dependency allowed: `pg`.
- No `package.json` exists on `main` yet (Melvin adds it with the contracts). Do NOT commit one; note needed deps in your final report.
- Deny any MCP/connector tool call. If a real API differs from the docs, STOP and report the exact response; do not guess.
- Commit on your lane branch with message `chip(sponsors): <what>`. Do not push.
- Final report: files changed, commands run with results, anything unverified.
