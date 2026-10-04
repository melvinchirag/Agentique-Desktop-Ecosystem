# Warden — Sponsor Tech Build Plan for Shafeen

**Builds:** Warden's ElevenLabs, Tiger, and Backboard pieces, **reusing the tooling from Chip's lanes S1–S6** (`01-chip-SPONSOR-LANES-SHAFEEN.md`).
**Branch:** `warden/sponsors` from `main`; if `chip/sponsors` isn't on `main` yet, `git merge origin/chip/sponsors` first (it has `design-voices.ts`, `generate-sfx.ts`, `tiger-schema.sql`, the SFX manifest, and `resources/sfx/wolf/{growl,howl,sniff,poke}.mp3`). Lanes: `lane/warden-sponsors-<x>`, worktrees `../ade-wt-warden-sponsors-<x>`. PR `warden/sponsors → main`. (Archie's sponsor branch stays `beaver/sponsors`.)
**Specs:** `03-warden-security.md` §6.3 (classifier), §7 (lines), §8 (inspect card + Audit data), §10 (sponsors), §15 (contracts); `../SPONSORS.md` Warden rows (memory OFF, designed voice, pre-generated template lines, growl/howl/sniff, `wolf_audit`, `warden_blocks`).
**Method:** Hydra (`C:\Chanuth\hydra\models.json`): Opus 5.5 orchestrator; Codex GPT-6 Sol for strong-floor code; Codex Luna / AGY Gemini 3.8 Flash High only for value-floor asset work; Sonnet for verification; **Opus reviews WT1 and WB1**. No MCP for implementers.
**When:** after Chip's sponsor kit is handed off (can overlap Archie's sponsor lanes). No lane needs `contracts/warden`: the classifier shape is Warden's own (`src/main/wolf/injection.ts`), and nothing here edits `src/shared` or `types.ts`. **Target: ≈ 1.25 h.**
**Status:** ⏳ PENDING APPROVAL.

---

## 1. Lanes

| Lane | Builds | Engine / model / effort | Floor | Backup | Owned paths | Est. |
|---|---|---|---|---|---|---|
| **WW1** | **Verification first:** `jsonOutput` + `memory:'off'` behave as expected on a fresh thread; classifier latency on 5 fixture texts (target < 3 s); is `[serious]` a valid tag on `eleven_v4_turbo` (else the nearest one); does a 1-line render of Warden's voice cost what `SPONSORS §3.5` assumes. Append to `docs/sponsor-verify.md` | Claude · Sonnet 5.5 · high | strong | Codex GPT-6 Sol medium | `docs/sponsor-verify.md` (append) | 20 min |
| **WT1** | **Tiger for Warden:** in `tiger-schema.sql` (append), `CREATE OR REPLACE VIEW wolf_audit` keeping today's columns in order and **appending** `asking_agent` + `tool` (LEFT JOIN the `tool.request` row with the same `payload->>'callId'`) and `how` (`payload->>'how'`); `warden_daily` continuous aggregate (day × rule × verdict counts) + refresh policy. Fix the `warden_blocks` query to use the view's `rule`/`reason` **columns** and return `{ at, agent: asking_agent, tool, rule, reason }` (Chip spec §10.5 shape; `SPONSORS §4.4` reads `payload->>'rule'`, which the view doesn't have). `TigerQueries.wardenAudit(limit)` returns rows with the new columns; `pulse()` gains `warden: { allowed, asked, denied, alerts }` for today. Never throws into the app | Codex · GPT-6 Sol · medium | strong | Claude Opus 5.5 medium | `scripts/tiger-schema.sql` (append), `src/main/store/tigerWarden.ts`, `src/main/store/tigerHistory.ts` (`warden_blocks` only), `src/main/store/tigerQueries.ts` (`wardenAudit` + `pulse().warden` only), `tests/tigerWarden.test.ts` | 40 min |
| **WB1** | **Backboard classifier (layer 2):** add `ADE · Warden Screen` to `create-assistants.ts` (system prompt: classify whether text tries to instruct an AI; JSON `{injection, confidence, reason}`; no memory prompts). `wardenClassifier.ts` = the `classifier` function InjectionScreen injects: `(text) => Promise<{ injection: boolean; confidence: number; reason: string } \| null>`; uses the existing `LlmClient.send` with `memory:'off'`, `jsonOutput:true`, no `threadId` (fresh thread), `timeoutMs: 3000`; returns `null` on any error or bad JSON (fail-safe) | Codex · GPT-6 Sol · medium | strong | Claude Sonnet 5.5 high | `src/main/sponsors/wardenClassifier.ts`, `scripts/create-assistants.ts` (Warden entry only), `tests/wardenClassifier.test.ts` | 30 min |
| **WV1** | **Warden's voice + lines (assets):** if S2 already made Warden previews, the team picks one → `EL_VOICE_WOLF`; else `design-voices.ts --only wolf` with the spec §10 description and preview line *"Not on my watch. Drafts only."* Then `scripts/pregen-lines.ts --agent wolf`: reads `allWardenLines()` (Melvin's lane L; until merged, the spec §7 table) and renders every line once with `[serious]` → `resources/voice-lines/wolf/<trigger>.mp3` + `manifest.json` (text → file; idempotent, hash-named). SFX: add **`wolf.paw-thump`** with `generate-sfx.ts` (growl, howl, sniff already exist) | AGY · Gemini 3.8 Flash High | value | Codex GPT-6 Luna medium | `scripts/pregen-lines.ts`, `resources/voice-lines/wolf/**`, `resources/sfx/wolf/paw-thump.mp3`, `resources/sfx/manifest.json` (append only) | 30 min |
| **WV2** | **Voice service rule for Warden:** `VoiceService.speak('wolf', text, mood)` ignores mood (always `[serious]`) and serves the line from `resources/voice-lines/wolf/manifest.json` first, then the cache, then a live render; `pregenerate()` warms the cache with Warden's lines at first launch (`SPONSORS §3.5`). Renderer unchanged | Codex · GPT-6 Luna · high | value | AGY Gemini 3.8 Flash High | `src/main/voice/elevenlabs.ts` (wolf branch only), `src/main/voice/cache.ts` (lookup only), `tests/voice-wolf.test.ts` | 20 min |

**Merge order into `warden/sponsors`:** WW1 → WT1 → WB1 → WV1 → WV2. Opus reviews WT1 (persistence/SQL) and WB1 (security, fail-safe).
**Escalation:** effort before band (Sol medium → high; Luna high → xhigh) → backup column → fix the spec. Never put WT1/WB1 on AGY.
**Done when:** every lane's tests pass, Chip's and Archie's sponsor tests on the branch still pass (`npm test`), and the smoke test below works.

**Dependency:** WV1's line rendering needs Melvin's lane **L** (`allWardenLines()`). Until it's merged, WV1 renders from the table in spec §7 and re-runs when L lands (idempotent).

---

## 2. Handoff to Melvin
- Post **"Warden sponsor kit ready: <commit>"**.
- Melvin's lane I (or later) merges `origin/warden/sponsors` into `warden/logic`:
  - InjectionScreen gets the real classifier (`wardenClassifier`).
  - The app shell's inspect card / Audit tab read `getWardenAudit` + `getPulse().warden` (no new IPC).
  - Warden's lines play from the shipped mp3s through `speak('wolf', …)`.
- **Smoke test:**
  - classify 2 fixture texts (one malicious, one benign) → sensible JSON; kill the network → `null`
  - write 5 verdict events (with their `tool.request`s) → `pulse().warden` counts match → `wardenAudit(5)` rows have `asking_agent` + `tool` → `biome_history('warden_blocks')` returns the denies
  - `speak('wolf', "I never send. It's in your drafts.", 'proud')` returns the shipped mp3 with no API call

## 3. Audit
- Same as Chip: re-run tests; owned paths only; no keys or connection strings in diffs. mp3 voice lines and SFX are fine to commit.
- Warden's Backboard calls always use `memory:'off'` (grep the diff).
