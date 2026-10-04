# Chip logic lanes: rules for every implementer

You are an **implementer** working in your own git worktree on branch `lane/chip-logic-<x>`.
The orchestrator (Melvin's Claude Opus session) wrote your lane file, will audit your work, and will merge it. You don't.

## Before you start
1. Read your lane file `docs/lanes/CHIP-<X>.md` and every spec section it lists. The spec is `docs/agents/01-chip-orchestrator.md` (v3.1). If your lane file and the spec disagree, **your lane file wins** (it holds the orchestrator's clarifications). If something is still unclear, STOP.
2. `node_modules` is already installed in your worktree. If not: `npm ci`.

## Hard rules
- **Only create or edit your lane's owned paths.** Nothing else, including docs.
- **Never edit** `src/shared/*`, `src/main/runtime/types.ts`, `src/main/bus/*`, `src/main/runtime/clock.ts`, `src/main/testing/settings.ts`, `package.json`, `package-lock.json`, `tsconfig.json`, `vitest.config.ts`. If you need a change there (or a new npm package), **STOP** and say exactly what and why.
- No network calls, no real API keys, no `.env`, no MCP/connector tools. Everything is tested with fakes.
- No Electron imports anywhere.
- Imports are relative and without file extensions (`'../shared/agents'`).
- TypeScript strict. No `any` in exported signatures. No `// @ts-ignore`.

## Shared pieces you should use (already on your branch)
| Need | Use |
|---|---|
| Interfaces | `src/main/runtime/types.ts` (frozen) |
| Event bus | `new EventBus({ clock })` from `src/main/bus/eventBus.ts` |
| Time | `Clock` everywhere. Tests use `FakeClock` from `src/main/runtime/clock.ts` (`advance(ms)`, `advanceAsync(ms)` when code awaits between timers, `flushPromises()`) |
| Settings | Inject `settings: () => AdeSettings`. Tests: `makeTestSettings(patch)` / `DEMO_TIMERS` from `src/main/testing/settings.ts` |
| Names | `AGENTS[id].displayName` from `src/shared/config.ts`. Code uses ids; speech uses names |

**Never use `Date.now()`, `setTimeout` or `setInterval` directly** in runtime code; always the injected `Clock`. Wall-clock math (quiet hours, 8 PM, Sunday) uses the **process local time** of `new Date(clock.now())`. Tests build dates with the local constructor, e.g. `new Date(2026, 9, 4, 23, 30)`.

## Event conventions (all lanes)
| Event | `agentId` | Notes |
|---|---|---|
| `job.update` | the job's `requestedBy` | `to` = the job's agent |
| `agent.handoff` | the job's `requestedBy` | `to` = job agent; `task` = job title; `via: 'ants'` when the job has `planStep` |
| `agent.say` (report) | the specialist | `priority: 'report'` |
| `agent.return` | the specialist | `to` = `requestedBy`; `summary` trimmed to 300 chars |
| `agent.presence`, `agent.mood` | the animal itself | |
| `user.mood`, `nudge.fire` | `'chipmunk'` | |
- Every event caused by a user request carries `taskId` (= the job's `parentTaskId`).
- **Privacy:** never put email bodies, file contents, or tokens in an event. Titles, counts, short summaries only.

## Done means
1. `npx tsc --noEmit` is clean and `npm test` is green (all tests, not just yours).
2. Every test your lane file lists exists and passes. Tests use fakes only and finish in well under 10 s.
3. **Do not commit, push, or merge.** Leave your changes uncommitted in the worktree; the orchestrator audits and commits them.
4. Final message: files changed, test count, anything you decided that the lane file didn't say, and any STOP.

## STOP means
Stop working, change nothing more, and report: what blocked you, what you need, and your best suggestion. A STOP is not a failure; it means the spec needs fixing.
