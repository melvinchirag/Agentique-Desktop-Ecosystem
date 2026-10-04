# Pixel lane T2 — other tools and CalendarSource

**Branch:** `lane/pixel-logic-t2` · **Codex model:** `gpt-6-luna` · **Effort:** high

## Objective
Build Calendar/Drive/Docs/Sheets/style tools and the Google calendar source for Chip's nudges.

## Owned paths
`src/main/agents/workspace/{calendarTools,driveTools,docsTools,sheetsTools,styleTool}.ts`; `src/main/connectors/google/calendarSource.ts`; `tests/pixel/{cal,drive,docs,sheets}*.test.ts`.

## Read
`docs/agents/04-pixel-workspace.md` §§3, 9.1, 16; `docs/agents/04-pixel-BUILD-LANES.md` §§2–3 (T2).

## Steps
1. Implement `cal_*`, `drive_*`, `docs_*`, `sheets_read`, and `style_get` from §3.2 with correct risk, preview, inspect, schema, and connection behavior.
2. Screen all outside text and keep raw bodies/cells out of events. Enforce `docs_append` ownership, A1/cell caps, safe Drive exports, and `docs_create` private artifact.
3. Map `CalendarApi` to `CalendarSource`: five-minute cache, screen titles, return `[]` when disconnected, throw on network errors.

## Checks — must run
`npx tsc --noEmit`; `npx vitest run tests/pixel/cal*.test.ts tests/pixel/drive*.test.ts tests/pixel/docs*.test.ts tests/pixel/sheets*.test.ts`; `npm test`. Cover P15–P24 tool cases, P25 and Chip C12 with `GoogleCalendarSource` over `FakeGoogle`.

## STOP
Stop if a schema or frozen API prevents the required safe behavior, if a write bypasses Warden preview, or if a privacy canary reaches events. Edit only owned paths.
