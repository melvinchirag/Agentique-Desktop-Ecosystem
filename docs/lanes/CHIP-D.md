# Lane D: Chip's prompt, turn builders, tools, acks, output parser

**Engine:** Claude · Sonnet 5.5 · high · **Backup:** Codex GPT-6 Sol medium · **Floor:** strong (writing)
**Branch:** `lane/chip-logic-d` · **First read:** `docs/lanes/README.md` (rules for every lane)

## Objective
Everything Chip *says to Backboard* and everything Chip's text is *parsed into*. Pure functions: no I/O, no timers, no bus.

## Owned paths (only these)
- `src/main/agents/chipmunk/names.ts`
- `src/main/agents/chipmunk/prompt.ts`
- `src/main/agents/chipmunk/tools.ts`
- `src/main/agents/chipmunk/acks.ts`
- `src/main/agents/chipmunk/parse.ts`
- `tests/chip-prompt.test.ts`

## Read
Chip spec: **§2** (names), **§10** (tool schemas, all of it), **§11** (system prompt + output parsing), **§12** (turn inputs), **§13** (acks). `src/shared/config.ts` for display names.

## Build

### `names.ts`
```ts
export const SPECIALIST_IDS: SpecialistId[];                // ['workspace','beaver','eagle','ants','butterfly','nightingale']
export function nameOf(id: AgentId): string;                // AGENTS[id].displayName
export function labelOf(id: AgentId): string;               // "Scout [eagle]"
/** "scout", "Scout", "eagle" → 'eagle'. Case-insensitive; accepts names or ids. Unknown → undefined. Never returns chipmunk/wolf. */
export function specialistFromWord(word: string): SpecialistId | undefined;
```

### `prompt.ts`
```ts
export function chipSystemPrompt(): string;     // §11 text exactly, names taken from AGENTS (so a rename updates it)

export interface ChipContextState {
  now: number;                                  // epoch ms
  timeZone: string;                             // IANA, e.g. 'America/Detroit'
  userMoodBefore: UserMood;
  jobs: Job[];                                  // running + queued (others are ignored)
  presence: Partial<Record<AgentId, Presence>>;
  installed: Record<AgentId, boolean>;
  recentResults: { agent: SpecialistId; finishedAt: number; summary: string }[];  // any order; builder uses the newest 5
}
export function buildContext(s: ChipContextState): string;
export function buildUserTurn(s: ChipContextState, text: string, voiceCues?: string[]): string;
export interface ResultItem { agent: SpecialistId; title: string; ok: boolean; summary: string; originalRequest: string; nextStep?: string }
export function buildResultTurn(s: ChipContextState, items: ResultItem[]): string;
export interface NudgeItem { kind: NudgeKind; about: string; question: string }
export function buildNudgeTurn(s: ChipContextState, items: NudgeItem[]): string;
```
Formats are **exactly §12**. Details the spec leaves open:
- `now:` line: `Sun, Oct 4, 12:42 AM (America/Detroit, UTC-04:00)`. Use `Intl.DateTimeFormat` with `s.timeZone`; the offset is computed for that zone at that instant (so it's `UTC-05:00` in winter).
- `jobs:` running → `Scout [eagle] running "Pizza near campus" 0:24` (elapsed m:ss since `startedAt`); queued → `Pixel [workspace] queued 1` (its position). Joined with ` | `. Running first, then queued by position. Line omitted when there are none.
- `installed:` every installed **specialist** (never Chip or Warden) as `Name [id] <presence>`, in `SPECIALIST_IDS` order, joined with `, `. Missing presence → `active`.
- `not_installed:` the specialists not installed, `Name [id]`, joined with `, `. Line omitted when empty.
- `recent_results:` newest 5, newest first: `- Scout [eagle], 3 min ago: <summary>`. Summary: newlines → spaces, trimmed to 200 chars (cut ending in `…`). Age: under 1 min → `just now`; under 60 min → `N min ago`; else `N h ago`. Block omitted when empty.
- User turn: `[context]` block, then `voice_cues: (sighs) (laughter)` only if cues are given, then `[user]` and the text.
- Result turn: `[job_results]` block first, then `[context]`. Each item:
  ```
  - Scout [eagle] · "Pizza near campus" · ok        (or · failed)
    summary: …
    original request: "…"
    next_step: … (or none)
  ```
- Nudge turn: `[nudge]` block (`- kind: after · about: …` + `  suggested question: …` per item), then `[context]`.

### `tools.ts`
```ts
export function chipTools(installed: SpecialistId[]): OpenAiTool[];
// order: report_user_mood, delegate, cancel_jobs, schedule_followup, biome_history
```
The schemas are **exactly §10.1–10.5**; the `agent` enum in `delegate` and `cancel_jobs` = `installed` (in `SPECIALIST_IDS` order). `ask_teammate` (§10.6) is NOT Chip's; skip it.

### `acks.ts`
```ts
export function pickAck(agent: SpecialistId, status: SubmitStatus, userMood: UserMood,
                        rand?: () => number): { text: string; bubble: string } | null;
```
§13 table exactly. `not_installed` → `null`. Angry or stressed user → `{ text: 'On it.', bubble: 'On it' }` for every status except `not_installed`. `rand` picks among lines when there is more than one (default `Math.random`). Bubble for `started`/`woke_and_started` = `<Name> <emoji>`.

### `parse.ts`
```ts
export interface ChipOutput { silent: boolean; bubble: string; speech: string }
export function parseChipOutput(text: string | null | undefined): ChipOutput;
```
§11 output parsing rules 1–4 exactly. Notes:
- `(silent)` (trimmed, case-insensitive) → `{ silent: true, bubble: '', speech: '' }`.
- Bubble line: `^\[bubble:\s*(.+?)\]$` on the first non-empty line.
- Sentence split on `.`, `!`, `?` (keep the punctuation). Keep at most 3 sentences.
- Empty speech → `silent: true`.
- Strip leftover markdown (`**`, `*`, `#`, leading `- `) from the speech.

## Tests (`tests/chip-prompt.test.ts`)
1. The system prompt contains every display name and id from §11 and the OUTPUT FORMAT block.
2. Snapshot-style string equality for one user turn, one result turn, and one nudge turn built from a fixed `ChipContextState` (`now` = 2026-10-04 04:42 UTC, `timeZone` `'America/Detroit'` → `Sun, Oct 4, 12:42 AM (America/Detroit, UTC-04:00)`). Write the expected strings out in full.
3. Empty `jobs` and `recentResults` → those lines are omitted.
4. `chipTools` enums exclude not-installed animals; exactly 5 tools; `ask_teammate` absent; `required` arrays match §10.
5. `pickAck`: each status; angry and stressed → "On it."; `not_installed` → null; deterministic with a fixed `rand`.
6. `parseChipOutput`: `(silent)`; a bubble line; a missing bubble line (bubble = first 2 words); 5 sentences → 3; markdown stripped; null input → silent.
7. `specialistFromWord`: "Scout", "eagle", "SCOUT" → `eagle`; "Warden", "Chip", "bob" → undefined.

## STOP if
The §11 or §12 text contradicts itself, or a format can't be made exact.
