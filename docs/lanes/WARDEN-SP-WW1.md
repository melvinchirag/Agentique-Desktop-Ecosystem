# WARDEN-SP-WW1 — Verification
**Branch:** `warden/sponsors` · **Plan:** `docs/agents/03-warden-SPONSOR-LANES-SHAFEEN.md` · **Spec:** `docs/agents/03-warden-security.md` §6.3, §7, §8, §10
**Engine:** Claude Opus (the orchestrator built it; Codex and AGY were not used)

## Objective
Classifier settings and latency on 5 fixtures, the [serious] tag, cost of a rendered line.

## Owned paths
docs/sponsor-verify.md (append)

## Done when
The lane's tests pass, Chip's and Archie's sponsor tests still pass (`npm test`), and `npx tsx scripts/warden-smoke.ts` passes.

## Rules
Never edit `src/shared` or `types.ts`. Warden's Backboard calls always use `memory: 'off'`. No keys or connection strings in commits.
