# SHAF-S2 — Voice Design: 8 original voices (Chip first)
**Branch:** `lane/chip-sponsors-s2` · **Spec:** `docs/SPONSORS.md` §1.2, §3.2 · **Engine:** Claude (orchestrator runs it; AGY not available)

## Objective
A script that designs original ElevenLabs voices for the 8 animals, saves previews for the team to pick from, and creates the picked voice.

## Owned paths
`scripts/design-voices.ts`, `voices/previews/**`, `voices/voices.json`

## Steps
1. `npx tsx scripts/design-voices.ts --agent chipmunk` → `POST /v1/text-to-voice/design` `{ model_id: 'eleven_multilingual_ttv_v2', voice_description, text }` → save each preview to `voices/previews/<agent>-<n>.mp3` and its `generated_voice_id` in `voices/voices.json`.
2. `--pick chipmunk=2` → `POST /v1/text-to-voice` `{ voice_name: 'ADE <Name>', voice_description, generated_voice_id }` → write `EL_VOICE_<AGENT>` to `.env` and the voice id to `voices/voices.json`.
3. Descriptions and preview lines come from `SPONSORS.md` §3.2 (preview text padded to the API minimum length, in character).
4. Order: chipmunk (team votes), wolf, workspace, beaver, eagle, ants, butterfly, nightingale. `--all` runs the rest.
5. Idempotent: skip an agent that already has previews unless `--force`.

## Tests / done when
Chip's previews exist and play; after the pick, a test line plays in Chip's voice.

## STOP if
The design or create endpoint, model id, or response shape differs from the above; or the key lacks a permission (report which).

## Rules for every lane
- Touch ONLY the owned paths below. Never edit `src/shared/*` or `src/main/runtime/types.ts`.
- Never print, log, or commit key values, `.env`, or connection strings. Read secrets from `.env` at the repo root (`BACKBOARD_API_KEY`, `ELEVENLABS_API_KEY`, `TIGER_DATABASE_URL`).
- Plain TypeScript, Node 22+, ES modules, runnable with `npx tsx <file>`. Use built-in `fetch`; no vendor SDKs. Only extra dependency allowed: `pg`.
- No `package.json` exists on `main` yet (Melvin adds it with the contracts). Do NOT commit one; note needed deps in your final report.
- Deny any MCP/connector tool call. If a real API differs from the docs, STOP and report the exact response; do not guess.
- Commit on your lane branch with message `chip(sponsors): <what>`. Do not push.
- Final report: files changed, commands run with results, anything unverified.
