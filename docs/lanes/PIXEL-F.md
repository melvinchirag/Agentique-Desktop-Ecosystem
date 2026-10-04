# Pixel lane F — fixtures and FakeGoogle

**Branch:** `lane/pixel-logic-f` · **Codex model:** `gpt-6-luna` · **Effort:** high

## Objective
Build deterministic offline Google fixtures, an in-memory `FakeGoogle` implementing the frozen `GoogleApi`, and a demo-account-only seed script. No test may reach a real Google account.

## Owned paths
`tests/fixtures/google/**`; `src/main/testing/fakeGoogle.ts`; `scripts/seed-demo-mailbox.ts`; `tests/fakeGoogle.test.ts`.

## Read
`docs/agents/04-pixel-workspace.md` §§2.5, 16 and `docs/agents/04-pixel-BUILD-LANES.md` §§2–3 (F). Use `src/main/connectors/google/api.ts` as the interface.

## Steps
1. Make 12 inbox messages (including a first-line injection, hidden HTML, quotes, newsletter, receipt, PDF attachment), 120 sent messages in one fictional voice, six events, and Drive/Doc/Sheet fixtures. Put a distinct `CANARY-<n>` in every body, doc, and cell.
2. Implement every sub-API in memory, recording `{ api, method, args }` for every call. Cover draft create/update/get/list, thread headers, event create/update, and document create/batchUpdate.
3. Make the seed script dry-run by default. `--apply` is required; check the signed-in address against `DEMO_GOOGLE_EMAIL` **before the first mutation**. Import mail and insert events; never send mail. Reuse Archie's `makeSandbox()` where available for attachment tests.

## Checks — must run
`npx tsc --noEmit`; `npx vitest run tests/fakeGoogle.test.ts`; `npm test`. Test draft round-trip, thread headers, canaries, and `sendUpdates:'none'` on event creation.

## STOP
Stop if the seed script could write to a non-demo account, the frozen `GoogleApi` cannot represent a required fixture operation, or the needed Archie sandbox is unavailable; report the exact gap. Edit only owned paths; request contract changes from the orchestrator.
