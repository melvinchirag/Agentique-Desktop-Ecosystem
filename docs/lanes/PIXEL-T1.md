# Pixel lane T1 — Gmail tools and registry

**Branch:** `lane/pixel-logic-t1` · **Codex model:** `gpt-6-sol` · **Effort:** high

## Objective
Build eight Gmail tools, ownership registry, attachment temp-file handling, and safe event-argument redaction.

## Owned paths
`src/main/agents/workspace/{gmailTools,registry,tempFile}.ts`; `src/main/runtime/redactArgs.ts`; `tests/pixel/gmail*.test.ts`.

## Read
`docs/agents/04-pixel-workspace.md` §§3.2–3.3, 5, 7, 13, 16; `docs/agents/04-pixel-BUILD-LANES.md` §§2–3 (T1); Archie §4.1 `safePath`.

## Steps
1. Implement `gmail_search`, `gmail_read_thread`, `gmail_digest`, `gmail_list_drafts`, `gmail_ask_attachment`, `gmail_create_draft`, `gmail_reply_draft`, `gmail_update_draft` using `ToolDefinition`, `inspect`, `preview`, and `riskFor` where applicable.
2. Screen raw HTML then extracted text; wrap every outside-written text field. Validate recipients and headers; derive reply recipients from the thread. Enforce attachment path, extension, and size rules.
3. Maintain serialized append-only draft/doc ownership rows without addresses or bodies; reject user-edited draft updates. Use a temp file under ADE's data directory and delete it in `finally`.
4. Redact sensitive `tool.request` arguments through the standalone helper; lane I installs it at the AgentRuntime hook.

## Checks — must run
`npx tsc --noEmit`; `npx vitest run tests/pixel/gmail*.test.ts`; `npm test`. Cover P6–P12, P21 attachment half, P25 Gmail, P27 Gmail privacy, header injection, recipient derivation, and no send calls in every fake scenario.

## STOP
Stop if Archie's `safePath` is unavailable and a fake cannot safely stand in, or if a required shared contract edit is needed. Never add send, permissions, or deletion calls; stop on a privacy canary leak.
