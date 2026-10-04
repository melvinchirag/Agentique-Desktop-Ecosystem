# Pixel lane I — integration

**Branch:** `lane/pixel-logic-i` · **Codex model:** `gpt-6-sol` · **Effort:** medium

## Objective
Wire Pixel into Chip, AgentRuntime, the core adapter, and chip-cli; verify offline scenarios and the demo-only send probe.

## Owned paths
`src/main/agents/workspace/{pixelRunner,probe}.ts`; `src/main/chipCore.ts` (Pixel wiring only); `src/main/runtime/agentRuntime.ts` (one marked `redactEventArgs` hook only); `scripts/chip-cli*` (Pixel scenarios only); `tests/scenarios/pixel/**`.

## Read
`docs/agents/04-pixel-workspace.md` §§2, 7, 12–13, 16; `docs/agents/04-pixel-BUILD-LANES.md` §§2–3 (I); `docs/agents/02-archie-files.md` §14; the actual AgentRuntime and Warden interfaces.

## Steps
1. Check `origin/beaver/logic` for the real `src/main/runtime/agentRuntime.ts`. If available, integrate against it on the integration branch, preserving Archie-owned code except the marked redaction hook. If unavailable or unmergeable, implement Pixel's `AgentDefinition` and runner wiring against `SpecialistRunner` with a fake runner and list the exact pending AgentRuntime hooks.
2. Register `workspace`, memory modes by job kind, injected `MemoryWriter`/`DocumentsApi` (fakes until sponsor kit), Google connection and style hooks, `googleEmail`/`styleLearnedAt`, and `GoogleCalendarSource` when connected. Start `DraftTracker`/`DraftsWaitingRule`; keep FakeCalendar fallback.
3. Install `redactEventArgs` where `tool.request` is emitted. Compose `PixelRunner` so a demo-mode send/forward/share request probes the real gate with synthetic `gmail_send_draft` and emits its verdict without executing it; disable probe outside demo mode.
4. Add chip-cli `/scenario P1…P36`, `/google login`, `/fixture`, and offline scenarios. Record any shell adapter/Warden/sponsor merge dependency precisely.

## Checks — must run
`npx tsc --noEmit`; `npx vitest run tests/scenarios/pixel`; `npm test`. Cover P30–P35 and Chip C2/C6/C19 with `FakeGoogle`; P36 is an orchestrator-only live smoke on a dedicated demo account.

## STOP
Stop before editing unowned Archie/Warden/shell files beyond the one marked hook, or if integration requires a shared contract change. If AgentRuntime is absent, deliver the fake-runner path and a clear pending list. Never run live account tests from this lane.
