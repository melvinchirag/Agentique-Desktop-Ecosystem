# WARDEN-SP-WB1 — Backboard classifier
**Branch:** `warden/sponsors` · **Plan:** `docs/agents/03-warden-SPONSOR-LANES-SHAFEEN.md` · **Spec:** `docs/agents/03-warden-security.md` §6.3, §7, §8, §10
**Engine:** Claude Opus (the orchestrator built it; Codex and AGY were not used)

## Objective
ADE · Warden Screen assistant; classifier(text) → {injection, confidence, reason} or null; memory off, JSON output, fresh thread, 3 s; null on any error.

## Owned paths
src/main/sponsors/wardenClassifier.ts, scripts/create-assistants.ts (Warden Screen), tests/wardenClassifier.test.ts

## Done when
The lane's tests pass, Chip's and Archie's sponsor tests still pass (`npm test`), and `npx tsx scripts/warden-smoke.ts` passes.

## Rules
Never edit `src/shared` or `types.ts`. Warden's Backboard calls always use `memory: 'off'`. No keys or connection strings in commits.
