# Pixel sponsor kit — handoff to Melvin

Branch: `pixel/sponsors`. It is built on `warden/sponsors` (which contains Archie part 2), so merge order is #13 → #14 → this. Nothing under `src/shared` or `types.ts` is changed.

## 1. Get it
```
git fetch && git switch pixel/logic && git merge origin/pixel/sponsors
npx tsx scripts/tiger-migrate.ts        # adds the unique index on drafts_log.gmail_draft_id; safe to repeat
```
New env values (Shafeen shares them privately): **`BB_ASSISTANT_WORKSPACE` changed** (Pixel's assistant was recreated with the new memory rules) and `EL_VOICE_WORKSPACE` is new.

## 2. Style memory (`StyleStore`)
```ts
const memory = new BackboardMemoryApi(llm, assistantIds);   // already the MemoryApi; its add() is the MemoryWriter
// const { id } = await memory.add('workspace', 'User email style: …');
// find by prefix → memory.update('workspace', id, line);   none → memory.add(...)
// await llm.deleteThread(threadId);                        // right after the learning call
```
- `add(agentId, text) → { id }` has the `MemoryWriter` shape from spec §15. The text is stored verbatim.
- Keep the style line short. 2,000 characters stored fine; **10,000 characters returned HTTP 500**.
- `deleteThread(threadId)` → `DELETE /threads/{id}`. It throws a `BackboardError` on failure; catch it in the learner.
- **Style-learning call: pass `timeoutMs: 60_000`.** Thirty samples took 12.5 s; the client's default is 25 s.
- Memory saved through a normal `Auto` turn appears 5 to 12 s later, not at once. `add` is immediate.

## 3. Drafts log (composite: local first, then Tiger)
```ts
import { TigerDraftsLog } from './src/main/store/tigerDrafts';
const tigerDrafts = new TigerDraftsLog(pool);
```
- Same shape as `DraftsLog` in spec §5.2. **`contracts/pixel` is not on `main` yet**, so `DraftRecord` and `DraftsLog` are declared in `tigerDrafts.ts` with the spec's exact shape; once the contract lands, the declaration there becomes an import from `types.ts`.
- `record` upserts on `gmailDraftId`: recording a draft again updates its time, count, and subject and **keeps its state**.
- Stored: draft id, recipient **count**, subject cut to 120 characters, state. A subject over 200 characters or with line breaks is treated as a body and the row is **dropped** (logged, without the text).
- `waiting(olderThanMs)` → drafts still `waiting` written at least that long ago, oldest first (max 100).
- Never throws: writes are dropped and `waiting` returns `[]` if Tiger is down.
- `pulse()` now has `pixel: { draftsToday, waiting }` (`draftsToday` is the current UTC day).

## 4. Voice and sounds
- `speak('workspace', text, mood)` works like every other animal (mood tags, cache). There are no shipped line files for Pixel.
- Stock lines to warm at first launch: `PIXEL_STOCK_LINES` in `scripts/pixel-smoke.ts`. The cache key includes the mood, so pre-generate each line with the mood it will be spoken in.
- New sounds in `resources/sfx/manifest.json`: `workspace.typing-loop` (loop) and `workspace.paper-shuffle`, next to `blip`, `stamp`, `poke`.
- The voice is provisional until Zarin's character exists; re-picking is one command.

## 5. Thread documents: Word files fail on Backboard's side
`.pdf` and `.txt` index and answer questions. **Two different `.docx` files both ended in status `error`** with a server-side message about a missing language model. `waitIndexed` returns `{ status: 'error' }` for them. Export Google Docs as PDF or text before uploading. Details: `docs/sponsor-verify.md` §P5.

## 6. Memory rules
`src/main/agents/workspace/memory-rules.ts` is the spec §10 text: facts only from the task text, never from tool results. The poisoning check (`scripts/pixel-memory-check.ts`) passed, and so did a control with default rules, so treat the rules as a second layer rather than the proven cause.

## 7. Smoke test
```
npx tsx scripts/pixel-smoke.ts
```
Expected: four `PASS` lines (style memory round trip; memory poisoning; drafts log incl. the no-network case; voice from cache + the two new sounds).
