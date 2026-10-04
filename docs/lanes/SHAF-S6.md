# SHAF-S6 — Sponsor verification report
**Branch:** `lane/chip-sponsors-s6` · **Spec:** every ⚠ item in `docs/SPONSORS.md` · **Engine:** Claude (orchestrator runs it)

## Objective
Answer every ⚠ verify item with evidence, so the other lanes build on facts.

## Owned paths
`docs/sponsor-verify.md`

## Steps
For each item: answer, evidence (vendor doc URL or a small real call with the response shape, never key values), and what to change in `SPONSORS.md`.
1. Backboard: bring-your-own provider key? exact memory search/update/delete paths? `tools` + `json_output` together? real response shape of `/threads/messages` and `/threads/tool-outputs`.
2. ElevenLabs: audio-tag words `eleven_v4_turbo` accepts; TTS-with-timestamps endpoint + response shape; SFX looping; plan tier (Music); Voice Design + SFX model ids; key permissions needed.
3. Tiger: TimescaleDB version; compression/columnstore syntax; the TLS CA requirement.

## Tests / done when
Every ⚠ item has a row. Unverifiable items are marked "not verified" with the reason.

## STOP if
A real call would spend more than a trivial amount of credits, or would change account state beyond a throwaway test object.

## Rules for every lane
- Touch ONLY the owned paths below. Never edit `src/shared/*` or `src/main/runtime/types.ts`.
- Never print, log, or commit key values, `.env`, or connection strings. Read secrets from `.env` at the repo root (`BACKBOARD_API_KEY`, `ELEVENLABS_API_KEY`, `TIGER_DATABASE_URL`).
- Plain TypeScript, Node 22+, ES modules, runnable with `npx tsx <file>`. Use built-in `fetch`; no vendor SDKs. Only extra dependency allowed: `pg`.
- No `package.json` exists on `main` yet (Melvin adds it with the contracts). Do NOT commit one; note needed deps in your final report.
- Deny any MCP/connector tool call. If a real API differs from the docs, STOP and report the exact response; do not guess.
- Commit on your lane branch with message `chip(sponsors): <what>`. Do not push.
- Final report: files changed, commands run with results, anything unverified.
