# Pixel lane N — draft tracking and waiting nudge

**Branch:** `lane/pixel-logic-n` · **Codex model:** `gpt-6-luna` · **Effort:** high

## Objective
Implement local drafts log, lifecycle tracking, and a deduplicated waiting-drafts nudge.

## Owned paths
`src/main/agents/workspace/drafts.ts`; `tests/pixel/drafts*.test.ts`.

## Read
`docs/agents/04-pixel-workspace.md` §§5, 9.2–9.3, 16; `docs/agents/04-pixel-BUILD-LANES.md` §§2–3 (N). Use frozen `DraftRecord`/`DraftsLog` contracts.

## Steps
1. Implement `LocalDraftsLog` over the registry; local writes first. A composite log writes a Tiger copy when injected and reads local with Tiger fallback.
2. `DraftTracker` checks drafts: 404 plus later SENT means sent; 404 otherwise deleted; network error leaves state unchanged.
3. `DraftsWaitingRule` uses injected `Clock`, `NudgeEngine.schedule`, and `NudgeStore.findByEvent`; after three hours schedule one custom/rule nudge, deduped across restarts; leave quiet hours to the nudge engine.

## Checks — must run
`npx tsc --noEmit`; `npx vitest run tests/pixel/drafts*.test.ts`; `npm test`. Cover P28 and P29 with fake clock and FakeGoogle.

## STOP
Stop if registry or nudge interfaces cannot support dedupe without a shared edit, or if draft subjects/bodies leak into events. Edit only owned paths.
