# Pixel lane S — email style learning

**Branch:** `lane/pixel-logic-s` · **Codex model:** `gpt-6-sol` · **Effort:** high

## Objective
Learn a privacy-preserving email style profile from sent mail and maintain its local cache and memory mirror.

## Owned paths
`src/main/agents/workspace/style/**` except `style/prompt.ts` (lane P); `tests/pixel/style*.test.ts`.

## Read
`docs/agents/04-pixel-workspace.md` §§6, 13, 16; `docs/agents/04-pixel-BUILD-LANES.md` §§2–3 (S). Use lane P's `style/prompt.ts` when present.

## Steps
1. Fetch up to 100 sent messages through `GmailApi`; clean quotes, forwards, bulk mail, footers, and recurring signatures; reject messages under 15 words.
2. Redact names, addresses, phones, URLs, and long digit runs. Compute stats; sample at most 30 messages, newest-biased across greeting types.
3. Call injected `LlmClient` with JSON output, memory off, no tools; validate, retry once, then use stats-only fallback. Report progress through injected callback.
4. Cache full profile locally; mirror a compact line **without examples** through `MemoryApi`/`MemoryWriter`. Relearn replaces it; `sync()` respects memory deletion by erasing local cache.

## Checks — must run
`npx tsc --noEmit`; `npx vitest run tests/pixel/style*.test.ts`; `npm test`. Cover P13 and P14 store behavior, quote styles, redaction, invalid JSON, and erase honoring.

## STOP
Stop and report if fewer than 15 fixture emails survive cleaning, if a raw sample/body reaches an event or memory write, or if frozen interfaces need changes. Edit only owned paths.
