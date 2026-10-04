# Pixel lane H — HTTP, Gmail, and MIME

**Branch:** `lane/pixel-logic-h` · **Codex model:** `gpt-6-sol` · **Effort:** high

## Objective
Implement the allowlisted Google transport and Gmail draft/read client, including safe MIME creation and parsing.

## Owned paths
`src/main/connectors/google/{http,allowlist,gmailClient,mime,mimeParse}.ts`; `tests/google/{http,allowlist,mime,gmailClient}.test.ts`.

## Read
`docs/agents/04-pixel-workspace.md` §§2.5–2.6, 3.3, 13, 16; `docs/sponsor-verify.md` Pixel G0 findings; `docs/agents/04-pixel-BUILD-LANES.md` §§2–3 (H).

## Steps
1. Enforce a method/path allowlist before fetch. Block send, delete/trash/modify, settings, permissions, and sharing endpoints.
2. Build `GoogleHttp`: bearer auth, one refresh on 401, 429/5xx backoff with jitter and `Retry-After`, three tries, 15-second timeout, and logs limited to method/path/status.
3. Implement Gmail search/read/thread/attachment/listSent/draft create/update/get/list. Use `uploadType=multipart` for drafts with JSON `threadId` and `message/rfc822`.
4. Build RFC 5322 MIME (UTF-8 subjects, folding, attachments, reply headers, CR/LF rejection) and parser (multipart, charset, HTML hidden-text detection, quote-strip hooks).

## Checks — must run
`npx tsc --noEmit`; `npx vitest run tests/google/http.test.ts tests/google/allowlist.test.ts tests/google/mime.test.ts tests/google/gmailClient.test.ts`; `npm test`. Cover P2 Gmail half, P3–P5, P31 and MIME round-trip. Run the P3 source grep for forbidden endpoints.

## STOP
Stop if draft multipart upload cannot carry `threadId`; report the response and G0 finding. Stop on an allowlist hole or a required change outside owned paths. Never add a send capability or log bodies, query text, or tokens.
