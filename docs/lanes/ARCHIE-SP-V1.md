# ARCHIE-SP-V1 — Archie's voice + sounds
**Branch:** `lane/beaver-sponsors-v1` · **Spec:** `docs/agents/02-archie-files.md` §9 · **Engine:** Claude (orchestrator runs it; AGY not available)

## Objective
Three voice previews for Archie for the team to pick from, then the picked voice; plus Archie's sounds that lane S4 did not make.

## Owned paths
`voices/previews/beaver-*`, `voices/voices.json` (beaver entry only), `resources/sfx/beaver/**`, `resources/sfx/manifest.json` (append only)

## Steps
1. `npx tsx scripts/design-voices.ts --only beaver` → `voices/previews/beaver-1..3.mp3`.
2. After the team picks: `--pick beaver=<n>` → `EL_VOICE_BEAVER` in `.env`.
3. `npx tsx scripts/generate-sfx.ts --only beaver` → adds `wood-gnaw-loop`, `paper-rustle`, `reverse-whoosh`. `tail-slap`, `log-thunk`, `wood-gnaw`, `poke` already exist and are skipped.

## Done when
Previews play; the three new sounds exist and are in the manifest.

## STOP if
An endpoint or response shape differs from `docs/sponsor-verify.md`.

## Rules
Owned paths only. Never print or commit keys or `.env`. Deny MCP tool calls. Do not push.
