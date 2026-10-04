# ARCHIE-D — Prompt, definition, and schemas

**Engine:** Claude Sonnet 5.5, high. **Branch:** `lane/beaver-logic-d`.

**Fallback execution (Oct 4):** Codex is implementing this lane with the planned backup, GPT-6 Sol medium. Claude's session quota is exhausted until 7:00 AM; this substitution is approved by Melvin.

**Audit status (Oct 4):** Implemented and pushed on `lane/beaver-logic-d` at `6ca882f`. Six targeted tests and the complete 286-test worktree suite pass; TypeScript and diff checks pass. Only the four owned paths changed. Unbound tools fail closed; real executors are injected by T/O. Shared rules use "biome" per DECISIONS. Hold the merge until F and P have merged, preserving F → P → D → R.

## Objective

Define Archie’s Backboard-facing personality, tools, schemas, and status copy without implementing filesystem behavior.

## Owned paths

- `src/main/agents/beaver/index.ts`
- `src/main/agents/beaver/prompt.ts`
- `src/main/agents/beaver/schemas.ts`
- `tests/beaver-prompt.test.ts`

## Read

- `docs/agents/02-archie-files.md` §§1, 4, 8, 10
- `docs/lanes/README.md`

## Build and test

1. Encode the exact Archie prompt and shared safety rules.
2. Export an `AgentDefinition` for `beaver`, max eight tool rounds, and all JSON schemas from §4.
3. Export status-detail helpers for sniffing, planning, and progress.
4. Snapshot prompt/turn content, validate schemas, and assert unique names.

## STOP

Stop if the prompt needs behavior from a tool executor or a shared contract change.
