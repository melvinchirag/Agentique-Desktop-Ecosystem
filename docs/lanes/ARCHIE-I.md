# ARCHIE-I — Integration

**Engine:** Claude Sonnet 5.5, high. **Branch:** `lane/beaver-logic-i`.

**Fallback execution (Oct 4):** Codex will implement this lane with the planned backup, GPT-6 Sol medium, once its Wave 1 and Wave 2 dependencies are merged. Claude's session quota is exhausted until 7:00 AM; this substitution is approved by Melvin.

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

## Orchestrator clarifications (Oct 4, after F P D R T O merged and Chip + shell came in from main)
- **Engine actually used:** Claude Sonnet 5.5 high (Codex's Windows sandbox can't write files; Codex's usage limit was hit). Same scope.
- **Everything you need is on your branch:** Chip's core `src/main/chipCore.ts` (`createChipCore`), `AgentRuntime` (`src/main/runtime/agentRuntime.ts`), `createBeaverAgent(bindings)` (`src/main/agents/beaver/index.ts`), `createReadToolBindings` (lane T), `createOrganizeToolBindings` + `sweepOldTrash` (lane O), `FileIndex`, `safePath`, `LocalFileOpsJournal`, `makeSandbox`, `FakeFsShell`, `StubWardenGate`, `TigerFileOpsJournal` (`src/main/store/tigerFileOps.ts`), the real `BackboardDocuments` (`src/main/sponsors/backboardDocuments.ts`).
- **Owned paths, widened:** `src/main/chipCore.ts` (additive Archie wiring only; do not change existing behavior or its tests), `scripts/chip-cli.ts` (add the `/sandbox` command only), `tests/scenarios/archie/*`. New file allowed: `src/main/connectors/fs/compositeJournal.ts`.
- **Circular wiring (important):** `createChipCore` builds the `JobScheduler` itself from a `runner`, but `AgentRuntime` needs that scheduler (for `ask_teammate` help jobs). Break the cycle with a lazy runner: pass `{ run: (...a) => runtime.run(...a) }` as `runner`, then create `runtime = createAgentRuntime({ jobs: core.jobs, ... })` after the core exists. Specialists other than Archie keep their fakes: route by agent id (`beaver` → the real runtime, everything else → `FakeSpecialists`).
- **Composite journal (spec §5):** write `createCompositeJournal(local, tiger?)`: `record` writes local first, then Tiger fire-and-forget (never throws into the caller); every read comes from local. Tiger is optional; with none it is just the local journal.
- **Warden and approvals do not exist yet** (Warden's own lanes come later). Use `StubWardenGate` for the gate. Write a small test `Approvals` in `tests/scenarios/archie/helpers.ts` (scripted approve/decline, implements the `Approvals` interface in `src/main/runtime/types.ts`; it must call `jobs.pauseClock/resumeClock` around a pending request). Mark in a comment that real Warden replaces both.
- **Scenarios:** implement spec §16 **A1–A16** (and A17–A20 where lanes T/O did not already cover them end to end through the runtime) as `tests/scenarios/archie/A01-….test.ts` etc., each driving Chip → Archie through `createChipCore` with a scripted `FakeLlm` for BOTH Chip and Archie's own calls (Archie's calls come from a second `FakeLlm` given to `AgentRuntime`). Every filesystem test uses `makeSandbox` in an OS temp dir and removes it afterwards. **Never a real folder.**
- **`/sandbox` in chip-cli:** `/sandbox` creates a fresh temp fixture sandbox, registers real Archie against it (allowed roots = the fixture's Desktop/Documents/Downloads), prints the fixture paths and the safe-to-run example sentences ("find my resume", "clean up my Downloads", "delete old-notes", "undo"), and removes the sandbox on `/quit`. Offline (fake brain) works with no keys.
- **No live run in this lane.** The orchestrator runs the live smoke against the fixture afterwards (credentials are not in your process).
- **Do not commit, push or merge.** Leave changes uncommitted; the orchestrator audits and commits.
