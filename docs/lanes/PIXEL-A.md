# Pixel lane A — OAuth and tokens

**Branch:** `lane/pixel-logic-a` · **Codex model:** `gpt-6-sol` · **Effort:** high

## Objective
Implement loopback OAuth with PKCE, safe token storage, single-flight refresh, disconnect, and a development login command.

## Owned paths
`src/main/connectors/google/{auth,loopback,tokenStore,googleAuthService}.ts`; `scripts/google-login.ts`; `tests/google/auth.test.ts`.

## Read
`docs/agents/04-pixel-workspace.md` §§2.2–2.4, 16; `docs/agents/04-pixel-BUILD-LANES.md` §§2–3 (A).

## Steps
1. Generate S256 PKCE and random 128-bit state; listen on `127.0.0.1:0`, verify state, close on success/error/3-minute timeout, and inject `openExternal`.
2. Implement encrypted `SafeStorageTokenStore` with memory-only fallback when encryption is unavailable; `MemoryTokenStore`; and gitignored dev-only `.ade-dev/` storage that refuses packaged execution. Never persist access tokens.
3. Build connect, scope validation, single-flight refresh, `invalid_grant` reconnect handling, and disconnect with revoke, token clear, and email clear.
4. Keep `fetch`, `safeStorage`, and `Clock` injected. No real account in tests.

## Checks — must run
`npx tsc --noEmit`; `npx vitest run tests/google/auth.test.ts`; `npm test`. Cover P1, P2, and P35 service behavior with fake token endpoint/browser/storage, including five concurrent refresh calls.

## STOP
If `google-auth-library` cannot perform PKCE for a desktop client, implement token exchange with injected `fetch` and document the decision. Stop if a package or contract edit is required outside owned paths; never commit credentials or plaintext tokens.
