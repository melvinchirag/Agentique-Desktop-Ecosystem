# ARCHIE-D — Prompt, definition, and schemas

**Engine:** Claude Sonnet 5.5, high. **Branch:** `lane/beaver-logic-d`.

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
