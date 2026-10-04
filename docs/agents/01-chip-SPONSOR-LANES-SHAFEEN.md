# Chip — Sponsor Tech Build Plan for Shafeen (Claude + Codex + AGY)

**What Shafeen builds:** the **Backboard, ElevenLabs, and Tiger Data** pieces Chip needs. Melvin builds Chip's logic (`01-chip-BUILD-LANES.md`). Zarin builds the graphics.
**Specs to read:** `../SPONSORS.md` (main), `01-chip-orchestrator.md §7` (interfaces), `../ARCHITECTURE.md §3, §6, §7`.
**Method:** Hydra flow plan (same as Melvin): one Claude Opus 5.5 orchestrator session; implementer lanes in separate git worktrees; cheapest model that meets each lane's floor; backups on another subscription; **no MCP access for implementers**.
**Target:** all Chip sponsor pieces done and handed to Melvin in ≈ 2–2.5 h.
**Branch:** Shafeen works on **`chip/sponsors`** (from `main` after Melvin's contracts PR lands); AI lanes use `lane/chip-sponsors-<s#>` and merge into `chip/sponsors`. Until the contracts land, S2/S4/S5a/S6 branch from `main` as it is. Full rules: `../GIT-WORKFLOW.md`.

---

## 1. How Shafeen's work and Melvin's fit together

```
            Melvin (Chip logic)                         Shafeen (sponsor tech)
  ┌───────────────────────────────────┐        ┌──────────────────────────────────────┐
  │ orchestrator, jobs, mood,         │ uses   │ BackboardClient (real LlmClient)     │
  │ presence, nudge engine, prompt    │◀───────│ TigerEventSink, TigerHistoryStore,   │
  │ (built against fakes + in-memory) │        │ TigerNudgeStore                       │
  └───────────────────────────────────┘        │ VoiceService (TTS + STT + cache)     │
                 ▲                              │ assistants, voices, SFX (assets)     │
                 │ same interfaces              └──────────────────────────────────────┘
        src/main/runtime/types.ts  (owned by Melvin's orchestrator; frozen after his Wave 0)
```

- **Melvin's repo area owns `src/shared/*` and `src/main/runtime/types.ts`.** Shafeen never edits them. If a lane needs a change, it STOPs and Shafeen's orchestrator asks Melvin's orchestrator.
- **Melvin's Lane B (Backboard client) moves to Shafeen** (lane S1 below). Melvin builds against `FakeLlm` until S1 lands.
- **Handoff = swap the fakes in `createChipCore(config)`:** `FakeLlm` → `BackboardClient`, in-memory history → `TigerHistoryStore`, in-memory nudge storage → `TigerNudgeStore`, plus `TigerEventSink` subscribed to the bus.

**Interfaces Shafeen implements** (added to Chip spec §7 and `types.ts` in Melvin's Wave 0):
```ts
interface LlmClient { send(p: SendParams): Promise<LlmResponse>; submitToolOutputs(threadId, outputs, signal?): Promise<LlmResponse> }   // S1
interface MemoryApi { list(agentId): Promise<Memory[]>; search(agentId, q): Promise<Memory[]>;
                      update(agentId, id, text): Promise<void>; remove(agentId, id): Promise<void> }                             // S1
interface EventSink { enqueue(e: BiomeEvent): void; flush(): Promise<void> }                                                       // S5
interface HistoryStore { query(kind: HistoryKind, sinceHours: number, agent?: AgentId): Promise<object[]> }                       // S5
interface NudgeStore { insert(n: Nudge): Promise<void>; update(id: string, patch: Partial<Nudge>): Promise<void>;
                       due(now: Date): Promise<Nudge[]>; findByEvent(eventId: string, kind: NudgeKind): Promise<Nudge | null> }   // S5
interface TigerQueries { taskEvents(taskId): Promise<BiomeEvent[]>; wardenAudit(limit): Promise<object[]>; pulse(): Promise<object> } // S5
interface VoiceService { speak(agentId: AgentId, text: string, mood: AgentMood): Promise<{ audio: ArrayBuffer; alignment?: object }>;
                         transcribe(audio: ArrayBuffer, mime: string): Promise<{ text: string; cues: string[] }>;
                         pregenerate(lines: { agentId: AgentId; text: string; mood?: AgentMood }[]): Promise<void> }              // S3
```

---

## 2. Human tasks for Shafeen (do these first, ~15 min)

| # | Task | Why |
|---|---|---|
| H1 | Get API keys: **Backboard**, **ElevenLabs** (check if the plan is paid, for Music), **Tiger Cloud** (create a free service, copy the connection string) | Every lane needs them |
| H2 | Put them in your own `.env` (never committed): `BACKBOARD_API_KEY`, `ELEVENLABS_API_KEY`, `TIGER_DATABASE_URL` | — |
| H3 | Share keys with Melvin **privately** (DM, not the repo) | His live run uses them |
| H4 | After S2 runs: **listen to the voice previews** and pick one per animal (Chip first; the team votes on Chip) | Voices are a team decision |

---

## 3. The heads (same catalog as Melvin, from Hydra `models.json`)

| Engine | Model | Band | Role here |
|---|---|---|---|
| Claude | **Opus 5.5** | frontier | **Orchestrator** (high): specs, audits, merges |
| Claude | **Sonnet 5.5** | strong | Writing/analysis lane (verification report, voice and SFX prompt copy) |
| Codex | **GPT-6 Sol** | strong | Main implementer (Backboard client, voice service, Tiger stores) |
| AGY | **Gemini 3.8 Flash High** | value | Scripted asset generation (voices, SFX): tool-use heavy, low risk |

Rules: AGY never gets a strong-floor lane · escalate effort before band · backups on another subscription · **Codex with `--ignore-user-config --disable apps`; deny MCP prompts in Claude/AGY.**

---

## 4. Waves

```
WAVE 0  (Opus, ~20 min) — read docs, H1–H3 done, worktrees, lane files docs/lanes/SHAF-<X>.md
          ├─ can start immediately: S2, S4, S5a, S6 (don't need types.ts)
          └─ wait for Melvin's Wave 0 push (~30 min in): S1, S3, S5b (implement types.ts interfaces)
WAVE 1  (parallel)
  S1  Backboard client + spike + assistants + memory API .. Codex GPT-6 Sol  medium   (floor strong)
  S2  Voice Design: 8 voices, previews, pick → voice IDs .... AGY  Gemini 3.8 Flash High (floor value)
  S3  VoiceService: TTS (v4 turbo + mood tags), STT, cache . Codex GPT-6 Sol  medium   (floor strong)
  S4  Sound effects + biome ambience (+ Celene music test) .. AGY  Gemini 3.8 Flash High (floor value)
  S5a Tiger schema SQL + migration runner ................. Codex GPT-6 Sol  high     (floor strong)
  S5b Tiger runtime: EventSink, History, Nudge store, queries  Codex GPT-6 Sol  high   (after S5a)
  S6  Sponsor verification report (the ⚠ list) ............ Claude Sonnet 5.5 high   (floor strong)
        merge order: S6 → S5a → S1 → S5b → S3 → S2 → S4
WAVE 2  (~20 min) — Handoff kit for Melvin: config snippet for createChipCore + live smoke test
```

**Subscription load:** Claude: orchestrator + S6 · Codex: S1, S3, S5a→S5b · AGY: S2, S4. Backups are listed per lane.

---

## 5. Lanes

### S1 — Backboard client, spike, assistants, memory API (Codex GPT-6 Sol medium · backup Claude Sonnet 5.5 high)
- **Owned:** `src/main/runtime/backboard.ts`, `src/main/sponsors/backboardMemory.ts`, `scripts/backboard-spike.ts`, `scripts/create-assistants.ts`, `src/main/agents/*/memory-rules.ts` (text only), `tests/backboard*.test.ts`
- **Build:**
  1. `BackboardClient implements LlmClient` exactly as Melvin's former Lane B: `fetch`; `POST /threads/messages`; `POST /threads/tool-outputs`; 25 s timeout combined with the caller's signal; retry once on network/timeout/5xx, never on 4xx or abort; non-2xx throws status + body. Extras: `listModels()` (`GET /models?model_type=llm&supports_tools=true`), `createAssistant()`.
  2. **Spike script:** create a test assistant → message with one dummy tool → submit output → print both responses + 20 model names → **write the real response shape into `docs/sponsor-verify.md`** (S6 merges it).
  3. **`create-assistants.ts`:** for all 8 animals: `POST /assistants { name: "ADE · <Name>", system_prompt, custom_fact_extraction_prompt, custom_update_memory_prompt }`. Memory rules from `SPONSORS.md §1.1` (Chip) and §2.3 (others; Warden gets none). Idempotent (skip IDs already in `.env`; `--force` recreates). Writes `BB_ASSISTANT_*`.
  4. **`MemoryApi`:** list / search / update / remove per agent (assistant id from env). Paths per `SPONSORS.md §2.2`; confirm them in the spike.
- **Tests:** mocked `fetch` (retry policy, abort not retried, request body shape, memory calls).
- **STOP if:** the real API shape differs from the docs. Report the JSON; don't guess.

### S2 — Voice Design: 8 original voices (AGY Gemini 3.8 Flash High · backup Codex GPT-6 Luna high)
- **Owned:** `scripts/design-voices.ts`, `voices/previews/**`, `voices/voices.json`
- **Build:**
  1. For each animal in `SPONSORS.md §3.2`: `text_to_voice.design({ model_id: 'eleven_multilingual_ttv_v2', voice_description, text: <preview line> })` → save every preview as `voices/previews/<agent>-<n>.mp3`, plus `generated_voice_id` in `voices/voices.json`.
  2. `--pick chipmunk=2` → `text_to_voice.create({ voice_name: 'ADE <Name>', voice_description, generated_voice_id })` → write `EL_VOICE_<AGENT>` to `.env` and `voices/voices.json`.
  3. **Order:** Chip first (the team votes), then Warden, Pixel (description may change after Zarin's design), Archie, Scout, Swarm, Iris, Celene.
- **Done when:** Chip's voice ID exists and a test line plays in Chip's voice.
- **AGY note:** run interactively; deny any MCP call.

### S3 — VoiceService: speak, hear, cache (Codex GPT-6 Sol medium · backup Claude Sonnet 5.5 high)
- **Owned:** `src/main/voice/elevenlabs.ts`, `src/main/voice/moodVoice.ts`, `src/main/voice/cache.ts`, `tests/voice*.test.ts`
- **Build:**
  1. **`speak(agentId, text, mood)`:** model `eleven_v4_turbo` (fallback `eleven_flash_v2_5` without tags on error); prefix the **audio tag** for the mood and apply **voice settings** from `SPONSORS.md §3.3` (`moodVoice.ts` holds that table); request **timestamps/alignment** if the endpoint is confirmed (S6), else audio only. Returns `{ audio, alignment? }`.
  2. **Cache:** key = sha256(voiceId + model + mood + text) → `%APPDATA%/ADE/voice-cache/<key>.mp3` (+ `.json` alignment). A cache hit makes no API call.
  3. **`pregenerate(lines)`:** fills the cache for acks, greetings, and Warden's template lines at first launch (concurrency 3).
  4. **`transcribe(audio, mime)`:** `POST /v1/speech-to-text`, multipart `file`, `model_id: 'scribe_v2'`, `tag_audio_events: true` → `text` with audio events removed + `cues` = the `audio_event` words (e.g. `(sighs)`).
  5. **`voiceEnabled = false`** → `speak` returns an empty result (bubbles only); no credits spent.
- **Tests:** mocked HTTP; tag + settings per mood; cache hit avoids the call; STT cue extraction.
- **STOP if:** v4 turbo rejects the tag words → report which ones it accepts (S6 updates the table).

### S4 — Sound effects + biome ambience (+ Celene music test) (AGY Gemini 3.8 Flash High · backup Codex GPT-6 Luna medium)
- **Owned:** `scripts/generate-sfx.ts`, `resources/sfx/**`, `resources/sfx/manifest.json`
- **Build:**
  1. Generate every sound in `SPONSORS.md §3.4` with `eleven_text_to_sound_v2`; one prompt per sound (e.g. *"tiny cartoon chipmunk chirp, cute, short, clean"*; *"two quick knocks on a glass window, light, playful"*).
  2. Save as `resources/sfx/<group>/<name>.mp3` + `manifest.json` (`{ id, file, durationMs, prompt }`).
  3. **Biome ambience:** forest loop (birds, stream, wind), 20–30 s. If looping isn't supported, generate it, and the renderer crossfades.
  4. **Celene test:** if the ElevenLabs plan is paid, one 20 s `POST /music/compose` (`music_v2_5`) calm track → `resources/music/test-calm.mp3`. If not paid, note it in `sponsor-verify.md`.
- **Done when:** the manifest lists all ~35 sounds and a quick listen sounds right (Shafeen spot-checks 10).

### S5a — Tiger schema (Codex GPT-6 Sol high · backup Claude Opus 5.5 medium)
- **Owned:** `scripts/tiger-schema.sql`, `scripts/tiger-migrate.ts`
- **Build:**
  1. One idempotent SQL file with everything in `ARCHITECTURE.md §6` + `SPONSORS.md §4.1`:
     - `biome_events` hypertable + indexes, compression (7 d, segment by `agent_id`), retention (90 d)
     - continuous aggregates `agent_activity_5m`, `mood_daily`, `job_stats_daily` + refresh policies
     - views `wolf_audit`, `job_history`, `user_mood_timeline`
     - tables `nudges` (+ `event_id TEXT`, unique `(event_id, kind)`), `file_ops`, `plan_items`, `drafts_log`, `research_log`
  2. `tiger-migrate.ts` runs it with `pg` against `TIGER_DATABASE_URL`. Safe to run twice.
- **Done when:** it runs twice against Tiger Cloud with no error, and `\d` shows every object.

### S5b — Tiger runtime stores (Codex GPT-6 Sol high · backup Claude Opus 5.5 medium) — after S5a merges
- **Owned:** `src/main/store/tiger.ts`, `src/main/store/tigerHistory.ts`, `src/main/store/tigerNudges.ts`, `src/main/store/tigerQueries.ts`, `tests/tiger*.test.ts`
- **Build:**
  1. **`TigerEventSink`:** `enqueue` → batch insert every 500 ms (max 200 rows per batch). On failure, append to `%APPDATA%/ADE/pending-events.jsonl` and retry the backlog every 30 s. **Never throws into the app.**
  2. **`TigerHistoryStore`:** the 4 `biome_history` SQL templates from `SPONSORS.md §4.4`, parameterized, max 20 rows.
  3. **`TigerNudgeStore`:** insert / update / due / findByEvent.
  4. **`TigerQueries`:** `taskEvents` (Replay), `wardenAudit`, `pulse` (`mood_daily` + `job_stats_daily` + `agent_activity_5m`).
- **Tests:** against a real Tiger dev service (a separate schema such as `ade_test`, dropped after) or a local Postgres + TimescaleDB container. Check that a Tiger outage falls back to the jsonl file.
- **Privacy check:** reject (log + drop) any event payload larger than 4 KB. That catches accidental email bodies.

### S6 — Sponsor verification report (Claude Sonnet 5.5 high · backup Codex GPT-6 Sol medium)
- **Owned:** `docs/sponsor-verify.md`
- **Answer each ⚠ item from `SPONSORS.md`**, reading vendor docs and, where safe, with one small real call:
  1. Backboard: bring-your-own provider key? Exact memory search/update/delete paths? `tools` + `json_output` together?
  2. ElevenLabs: exact audio-tag words for `eleven_v4_turbo`; the TTS-with-timestamps endpoint + response shape; SFX looping; is the plan paid (Music)?
  3. Tiger: the compression/columnstore syntax on the service's TimescaleDB version.
- **Output:** a table per item: answer, source URL, and what to change in `SPONSORS.md`. Shafeen's orchestrator applies the changes.

---

## 6. Wave 2 — Handoff kit for Melvin (~20 min, Shafeen's orchestrator)
1. `docs/handoff/chip-sponsors.md`: the exact `createChipCore` config to swap fakes for real pieces, the env vars needed, and how to run the live smoke test.
2. **Live smoke test** (`scripts/sponsor-smoke.ts`), which must pass before handoff:
   - Backboard: one Chip-style message with `report_user_mood` comes back as `REQUIRES_ACTION`
   - ElevenLabs: Chip says "On it!" (from cache on the second run)
   - STT: transcribes a short sample with a cue
   - Tiger: write 10 events → read them back by `task_id`
3. Post in the team chat: "Sponsor kit ready: <commit>".

---

## 7. Audit + merge (Shafeen's orchestrator, per lane)
1. Re-run the lane's tests yourself; don't trust the report.
2. `git diff --stat chip/sponsors...lane/chip-sponsors-<s#>`: owned paths only. **No `.env`, keys, or connection strings in the diff.** Voice previews and SFX mp3s are fine to commit; the cache dir is not (add it to `.gitignore`).
3. Fragile code (S1 retries, S5b batching/fallback) gets a **cross-vendor review**: Codex code → reviewed by Opus.
4. Merge one lane at a time **into `chip/sponsors`**: **S6 → S5a → S1 → S5b → S3 → S2 → S4**. `npm test` on `chip/sponsors` after each. Push. When done → post "sponsor kit ready" and open PR `chip/sponsors → main` (Chanuth merges at integration).
5. **Escalation:** one effort notch up → the backup column → fix the spec.

---

## 8. Dispatch commands (PowerShell; same as Melvin's)
- **Codex:** `Get-Content -Raw docs\lanes\SHAF-S1.md | codex exec - -m gpt-6-sol -c model_reasoning_effort="medium" --ignore-user-config --disable apps -C . --color never -o ..\shaf-s1-final.md` (run inside the lane's worktree; add `-s danger-full-access` only if the Windows sandbox errors).
- **Claude:** interactive in the worktree → `claude --model sonnet` → `/effort high` → "Read docs/lanes/SHAF-S6.md and do exactly that lane." Deny MCP prompts.
- **AGY:** interactive → `agy --model gemini-3.8-flash-high` → same instruction. Deny MCP prompts.
- **Never** paste prompts as quoted arguments; pipe them through stdin.

---

## 9. Timeline (from when Shafeen starts)

| Clock | Milestone |
|---|---|
| +0:15 | Keys in hand (H1–H3) |
| +0:20 | Wave 0 done; S2, S4, S5a, S6 running |
| +0:30 | Melvin's Wave 0 pushed → S1, S3 start |
| +0:45 | **Chip voice previews ready → team picks Chip's voice** |
| +1:15 | S5a merged → S5b starts |
| +1:45 | S1, S3, S6 merged; SFX done |
| +2:15 | S5b merged; Wave 2 handoff kit + smoke test |
| **+2:30** | **"Sponsor kit ready"** → Melvin plugs in real Backboard, Tiger, and voice |

## 10. After Chip
The same lanes extend to the other animals as their specs land: their assistants (S1 script already covers all 8), voices (S2 already covers all 8), their Tiger tables (`file_ops`, `plan_items`, `drafts_log`, `research_log`) already exist from S5a.
