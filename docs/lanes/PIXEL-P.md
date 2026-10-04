# Pixel lane P — prompt and schemas

**Branch:** `lane/pixel-logic-p` · **Codex model:** `gpt-6-sol` · **Effort:** medium

## Objective
Define Pixel's prompt, AgentDefinition, all 18 final tool schemas, safe status strings, and the style-learning prompt.

## Owned paths
`src/main/agents/workspace/{index,prompt,schemas,status}.ts`; `src/main/agents/workspace/style/prompt.ts`; `tests/pixel/prompt.test.ts`.

## Read
`docs/agents/04-pixel-workspace.md` §§1, 3–4, 6.3, 12, 16; `docs/AGENTS.md` shared RULES; `docs/agents/04-pixel-BUILD-LANES.md` §§2–3 (P).

## Steps
1. Define `AgentDefinition` with `id:'workspace'`, `maxToolRounds:8`, the spec's final answer format, safe drafting rules, and shared RULES.
2. Encode the 18 §3.2 schemas exactly, including parameter names and bounds. Keep `index.ts` able to register tool executors from T1/T2 when they land; do not edit their files.
3. Centralize only count/action status strings; no subject, sender, body, or file content in a status event.
4. Write the §6.3 learning prompt with stats, redacted samples, and JSON-only output constraints.

## Checks — must run
`npx tsc --noEmit`; `npx vitest run tests/pixel/prompt.test.ts`; `npm test`. Snapshot prompt/schema output; validate JSON Schemas, unique names, no `fs_*` collisions or W1 name segments, and required previews in tool definitions when available.

## STOP
Stop if the spec's exact schemas conflict with the frozen tool contract or a required import has no stable interface. Do not change tool names, shared contracts, or another lane's files.
