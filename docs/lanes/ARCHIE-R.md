# ARCHIE-R — AgentRuntime

**Engine:** Codex GPT-6 Sol, high. **Branch:** `lane/beaver-logic-r`.

## Objective

Implement the generic `AgentRuntime` used by every specialist, including Archie. It implements `SpecialistRunner`, creates a fresh job thread, runs parallel tool calls, gates risky calls through Warden, pauses job clocks for approvals, supports one-level `ask_teammate`, and returns parsed `AgentResult` values.

## Owned paths

- `src/main/runtime/agentRuntime.ts`
- `src/main/runtime/specialistOutput.ts`
- `tests/agentRuntime.test.ts`

## Read

- `docs/agents/02-archie-files.md` §§14–15
- `docs/agents/01-chip-orchestrator.md` §§3, 4.1, 7, 8, 16
- `docs/ARCHITECTURE.md` §4.3
- `docs/lanes/README.md`

## Build and test

1. Build the registry, fresh-thread LLM loop, 12k output cap, artifact collection, one Backboard retry, and BUBBLE/SAY/SUMMARY parser with documented fallbacks.
2. Inject `ask_teammate` only for normal jobs; submit help jobs and await their result.
3. Send every normal tool through `WardenGate`; pause/resume its job clock while awaiting an approval.
4. Test parallel calls, denied and declined calls, approval pause, no help-job recursion, parser fallbacks, and artifacts.

## STOP

Stop if PR #11's Warden interfaces are not merged or any shared type cannot express the spec. Do not alter shared contracts.
