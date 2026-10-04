# ARCHIE-I — Integration

**Engine:** Claude Sonnet 5.5, high. **Branch:** `lane/beaver-logic-i`.

## Objective

Replace the fake Beaver with real Archie in Chip’s core and prove the Archie scenarios against the fixture.

## Owned paths

- `src/main/chipCore.ts` (Archie wiring only)
- `tests/scenarios/archie/*`

## Read

- `docs/agents/02-archie-files.md` §§4–6, 14, 16–18
- `docs/agents/02-archie-BUILD-LANES.md`
- `docs/lanes/README.md`

## Build and test

1. Register Archie in `AgentRuntime`; retain fakes for other specialists.
2. Use the local journal first, then add Tiger as a non-blocking copy when the sponsor kit is ready.
3. Add fixture-only chip-cli scenarios A1–A16 and `/sandbox` support.
4. Prove A1–A16 offline, then the designated live smoke cases against the fixture only.

## STOP

Stop if a path leaves the fixture sandbox or the required sponsor interface has not landed.
