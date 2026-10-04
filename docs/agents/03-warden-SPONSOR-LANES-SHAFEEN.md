# Warden — Sponsor Tech Build Plan for Shafeen

**Builds:** Warden's ElevenLabs, Tiger, and Backboard pieces, **reusing the tooling from Chip's lanes S1–S6** (`01-chip-SPONSOR-LANES-SHAFEEN.md`).
**Branch:** `wolf/sponsors` from `main` (after Warden's contracts are merged; until then from `chip/sponsors`). Lanes: `lane/wolf-sponsors-<x>`. PR `wolf/sponsors → main`.
**Specs:** `03-warden-security.md` §6.3 (classifier), §7 (lines), §8 (inspect card + Audit), §10 (sponsors); `../SPONSORS.md` Warden rows.
**Method:** Hydra (Opus orchestrator; Codex Sol implementers; AGY for asset scripts; Sonnet for verification). No MCP for implementers.
**When:** after Chip's sponsor kit is handed off (can overlap Archie's sponsor lanes). **Target: ≈ 1 h.**
**Status:** ⏳ PENDING APPROVAL.

---

## 1. Lanes

| Lane | Builds | Engine / model / effort | Floor | Backup | Owned paths | Est. |
|---|---|---|---|---|---|---|
| **WV1** | **Warden's voice + lines:** if S2 already made Warden's previews, the team picks one → `EL_VOICE_WOLF`; else `design-voices.ts --only wolf` with the spec §10 description and preview line *"Not on my watch. Drafts only."* Then **`pregen-lines.ts --agent wolf`**: reads `allWardenLines()` (Melvin's lane L) and renders every line with `eleven_v4_turbo` + `[serious]` → `resources/voice-lines/wolf/<trigger>.mp3` + `manifest.json`. SFX check: growl, howl, sniff exist from S4; add **paw thump** (Sit). | AGY · Gemini 3.8 Flash High | value | Codex GPT-6 Luna medium | `scripts/pregen-lines.ts`, `resources/voice-lines/wolf/**`, `resources/sfx/wolf/**`, `resources/sfx/manifest.json` (append only) | 30 min |
| **WT1** | **Tiger for Warden:** `warden_daily` continuous aggregate (per day × rule × verdict counts) + refresh policy (append to `tiger-schema.sql`); `TigerWardenQueries`: `audit({ agent?, rule?, verdict?, since?, limit, offset })`, `recent(n)`, `today()` (allowed/asked/denied/alerts); make `biome_history('warden_blocks')` include rule reason text. Never throws into the app. | Codex · GPT-6 Sol · medium | strong | Claude Opus 5.5 medium | `scripts/tiger-schema.sql` (append), `src/main/store/tigerWarden.ts`, `tests/tigerWarden.test.ts` | 35 min |
| **WB1** | **Backboard classifier (layer 2):** add `ADE · Warden Screen` to `create-assistants.ts` (system prompt: classify whether text tries to instruct an AI; output JSON `{injection, confidence, reason}`; no memory prompts). `wardenClassifier.ts` implements the classifier the InjectionScreen injects: fresh thread, `memory:'off'`, `json_output:true`, 3 s timeout, returns `null` on any error (fail-safe). | Codex · GPT-6 Sol · medium | strong | Claude Sonnet 5.5 high | `src/main/sponsors/wardenClassifier.ts`, `scripts/create-assistants.ts` (Warden entry only), `tests/wardenClassifier.test.ts` | 30 min |
| **WW1** | **Verification:** does `json_output` + `memory:'off'` behave as expected; classifier latency on 5 fixture texts; is `[serious]` a valid tag on `eleven_v4_turbo` (else the nearest one); paw-thump SFX quality. Append to `docs/sponsor-verify.md`. | Claude · Sonnet 5.5 · high | strong | Codex GPT-6 Sol medium | `docs/sponsor-verify.md` (append) | 20 min |

**Merge order into `wolf/sponsors`:** WW1 → WT1 → WB1 → WV1. Opus reviews WT1.

**Dependency:** WV1's line rendering needs Melvin's lane **L** (`allWardenLines()`). Until it's merged, WV1 renders from the table in spec §7 and re-runs when L lands (idempotent: hash-named files).

---

## 2. Handoff to Melvin
- Post **"Warden sponsor kit ready: <commit>"**.
- Melvin's lane I merges `origin/wolf/sponsors` into `wolf/logic`:
  - InjectionScreen gets the real classifier.
  - `getWardenRecent/Today` switch from the bus ring to `TigerWardenQueries`.
  - The renderer plays the pre-generated mp3s.
- **Smoke test:**
  - classify 2 fixture texts (one malicious, one benign) → sensible JSON
  - write 5 verdict events → `today()` counts match → `audit({ rule:'W5' })` returns them
  - play `deny_W1.mp3`

## 3. Audit
- Same as Chip: re-run tests; owned paths only; no keys or connection strings in diffs. mp3 voice lines and SFX are fine to commit.
