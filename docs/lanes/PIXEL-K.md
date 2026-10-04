# Pixel lane K — Calendar, Drive, Docs, Sheets clients

**Branch:** `lane/pixel-logic-k` · **Codex model:** `gpt-6-sol` · **Effort:** high

## Objective
Implement non-Gmail Google clients and deterministic Markdown-to-Docs requests.

## Owned paths
`src/main/connectors/google/{calendarClient,driveClient,docsClient,docsMarkdown,sheetsClient}.ts`; `tests/google/{calendar,drive,docs,docsMarkdown,sheets}.test.ts`.

## Read
`docs/agents/04-pixel-workspace.md` §§2.5, 3.3, 16 (P15/P19/P22/P24); `docs/agents/04-pixel-BUILD-LANES.md` §§2–3 (K).

## Steps
1. Calendar list/create/update must set `sendUpdates:'none'` inside the client; update only fields supplied by the caller.
2. Drive search builds and escapes structured `q` and excludes trashed files; support get/export/download.
3. Docs create/batchUpdate/getEndIndex; Sheets info/getValues; use the frozen `GoogleApi` and lane H transport.
4. Convert headings, paragraphs, bullets, numbering, bold, and HTTPS links to Docs requests. Compute style ranges in UTF-16 code units.

## Checks — must run
`npx tsc --noEmit`; `npx vitest run tests/google/calendar.test.ts tests/google/drive.test.ts tests/google/docs.test.ts tests/google/docsMarkdown.test.ts tests/google/sheets.test.ts`; `npm test`. Cover P15 client half, P19, P22 builder half, P24 client half. Include emoji+CJK heading followed by a bullet list.

## STOP
Stop and report if `batchUpdate` ranges remain wrong for non-BMP text after fixing the case, or an API/transport contract cannot support required operations. No permissions/sharing calls.
