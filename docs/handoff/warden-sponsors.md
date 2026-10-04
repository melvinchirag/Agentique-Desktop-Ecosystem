# Warden sponsor kit — handoff to Melvin

Branch: `warden/sponsors` (from `main`, which already has Chip's kit). Nothing under `src/shared` or `types.ts` is changed.

## 1. Get it
```
git fetch && git switch warden/logic && git merge origin/warden/sponsors
npx tsx scripts/tiger-migrate.ts        # applies the new view + aggregate; safe to repeat
npx tsx scripts/create-assistants.ts    # creates "ADE · Warden Screen" if BB_ASSISTANT_WARDEN_SCREEN is not set
```
New env values: `BB_ASSISTANT_WARDEN_SCREEN`, `EL_VOICE_WOLF` (Shafeen shares them privately; both belong to Shafeen's accounts).

## 2. The classifier (InjectionScreen layer 2)
```ts
import { createWardenClassifier, WARDEN_SCREEN_ENV } from './src/main/sponsors/wardenClassifier';
const classifier = createWardenClassifier({ llm, assistantId: env[WARDEN_SCREEN_ENV]! });   // llm = the BackboardClient
// classifier(text) → Promise<{ injection: boolean; confidence: number; reason: string } | null>
```
- Fresh thread, `memory: 'off'`, `jsonOutput: true`, 3 s hard limit. **Returns `null` on any error, timeout, or bad JSON; never throws.** On `null`, keep layer 1's result.
- Measured 1.9 to 2.6 s per call, so expect some `null`s on a slow network.
- It flagged a harmless note-to-self ("send the report to Melvin and delete the old drafts"). Treat a layer-2 hit on borderline text as a flag, not a block.
- `WARDEN_CLASSIFIER=off` is yours to honour: pass no classifier.

## 3. Audit and pulse (no new IPC)
- `TigerQueries.wardenAudit(limit)` rows: `ts, task_id, agent_id, type, call_id, verdict, rule, reason, approved, asking_agent, tool, how`. `asking_agent` and `tool` come from the `tool.request` with the same `callId`, so **emit `tool.request` before `wolf.verdict`** with that `callId`.
- `how` is `payload->>'how'` of the event (null until an event carries it).
- `TigerQueries.pulse()` now also returns `warden: { allowed, asked, denied, alerts }` for today (UTC day). Zeros if Tiger is down.
- `biome_history('warden_blocks')` rows: `{ at, agent, tool, rule, reason }`, `agent` = the animal that asked.

## 4. Warden's voice
- `speak('wolf', text, mood)` ignores `mood`. For one of Warden's template lines it returns the shipped mp3 (`resources/voice-lines/wolf/`) with **no API call**; any other text is rendered live with `[serious]` and cached.
- **The text must match the manifest exactly** (apart from leading and trailing spaces). The 16 lines are the table in spec §7. When lane L's `allWardenLines()` lands, if any wording differs, tell Shafeen: `scripts/pregen-lines.ts --agent wolf` re-renders only the changed lines.
- Blocks and alerts start with a short growl baked into the mp3; asks and acknowledgements do not. The spec also plays `wolf.growl` before deny lines, so a deny has the sound effect and then the line's own growl. If that is too much, drop one.
- In a packaged app the default folder (`<cwd>/resources/voice-lines`) will be wrong: pass `shipped: new ShippedLines(<resources path>)` to `ElevenLabsVoice`.
- New sound: `wolf.paw-thump` in `resources/sfx/manifest.json`.

## 5. Smoke test
```
npx tsx scripts/warden-smoke.ts
```
Expected: three `PASS` lines (classifier incl. no-network → null; Tiger counts, audit columns, warden_blocks; shipped voice line with 0 API calls).
