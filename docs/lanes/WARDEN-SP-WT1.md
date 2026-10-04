# WARDEN-SP-WT1 — Tiger for Warden
**Branch:** `warden/sponsors` · **Plan:** `docs/agents/03-warden-SPONSOR-LANES-SHAFEEN.md` · **Spec:** `docs/agents/03-warden-security.md` §6.3, §7, §8, §10
**Engine:** Claude Opus (the orchestrator built it; Codex and AGY were not used)

## Objective
wolf_audit gains asking_agent, tool, how; warden_daily aggregate; warden_blocks reads view columns; pulse().warden counts. Never throws.

## Owned paths
scripts/tiger-schema.sql, src/main/store/tigerWarden.ts, tigerHistory.ts (warden_blocks), tigerQueries.ts (wardenAudit, pulse().warden), tests/tigerWarden.test.ts

## Done when
The lane's tests pass, Chip's and Archie's sponsor tests still pass (`npm test`), and `npx tsx scripts/warden-smoke.ts` passes.

## Rules
Never edit `src/shared` or `types.ts`. Warden's Backboard calls always use `memory: 'off'`. No keys or connection strings in commits.
