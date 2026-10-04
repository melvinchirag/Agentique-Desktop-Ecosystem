# Sponsor verification report (lane S6)

Checked on 2026-10-04 with small real calls against Shafeen's accounts. No key values appear here.
"Verified" means a real call returned the result shown. "Not verified" items say why.

## Summary
| # | Item (⚠ in `SPONSORS.md`) | Result |
|---|---|---|
| B1 | Backboard `/threads/messages` + `/threads/tool-outputs` shape | ✅ Verified, matches the plan |
| B2 | Memory list / search / get / update / delete / add paths | ✅ Verified (search is **POST**, not GET) |
| B3 | `tools` + `json_output` in one call | ✅ Accepted (200); the model called the tool first |
| B4 | Models list | ✅ Verified; **the list is huge (13,438), page it** |
| B5 | Users plug in their own provider API key | ❌ Not verified (no call tested it) |
| E1 | Audio-tag words on `eleven_v4_turbo` | ✅ All nine accepted and not read aloud |
| E2 | Voice settings (stability / style / speed) on `eleven_v4_turbo` | ✅ Accepted |
| E3 | TTS with timestamps | ✅ Verified: `/with-timestamps`; **alignment includes the tag characters** |
| E4 | Fallback `eleven_flash_v2_5` | ✅ Works |
| E5 | Plan is paid (Music) | ✅ Creator tier, active |
| E6 | Voice Design model + endpoints | ✅ Verified (Chip's voice created) |
| E7 | SFX model id, looping, Music endpoint | ✅ Verified (35 sounds + ambience + music generated) |
| T1 | Compression / retention / continuous-aggregate syntax | ✅ Verified on TimescaleDB 2.30.2 |
| T2 | TLS | ⚠ **Tiger Cloud needs its own CA certificate** (not in the plan) |

---

## Backboard (base `https://app.backboard.io/api`, header `X-API-Key`)

### B1. Message and tool-call shape — verified
`POST /threads/messages` with `{ assistant_id, content, tools, llm_provider, model_name, memory, stream: false }` → 200.
Response fields: `thread_id`, `assistant_id`, `content` (null while a tool call is pending), `status`, `tool_calls`, `run_id`, `message_id`, `role`,
`memory_operation_id`, `retrieved_memories`, `retrieved_files`, `model_provider`, `model_name`, `input_tokens`, `output_tokens`, `total_tokens`, `context_usage`, `created_at`.

- With a tool: `status: "REQUIRES_ACTION"`, `tool_calls: [{ id, type: "function", function: { name, arguments } }]`. `arguments` is a **JSON string**.
- `POST /threads/tool-outputs` with `{ thread_id, tool_outputs: [{ tool_call_id, output }] }` → 200, `status: "COMPLETED"`, `content` filled. Same response fields.
- Omitting `thread_id` creates a new thread and returns its id.
- `retrieved_memories` is `null` (not `[]`) when nothing was recalled. Treat null as empty.
- `memory_operation_id` was `null` on every call, including `memory: 'Auto'` calls that did save a memory. The plan already ignores it.

**Change in `SPONSORS.md`:** none. The `LlmResponse` contract in Chip spec §7 fits.

### B2. Memory API — verified
| Purpose | Call | Result |
|---|---|---|
| List | `GET /assistants/{id}/memories` | 200 `{ memories: [{ id, content, metadata, score, created_at, updated_at }], total_count }` |
| Search | **`POST`** `/assistants/{id}/memories/search` body `{ query, limit }` | 200 `{ memories: [{ id, content, score, ... }], total_count }` |
| Search (GET) | `GET /assistants/{id}/memories/search?query=` | **404** — do not use |
| Get one | `GET /assistants/{id}/memories/{memory_id}` | 200 |
| Update | `PUT /assistants/{id}/memories/{memory_id}` body `{ content }` | 200, returns the updated memory |
| Delete | `DELETE /assistants/{id}/memories/{memory_id}` | 200 `{ success: true }` |
| Add | `POST /assistants/{id}/memories` body `{ content }` | 201 `{ success, memory_id, content }` |

Memory behaviour seen live: a fact saved in one thread was recalled in a fresh thread started by a new process, and a newer fact replaced an older one instead of duplicating it.

**Change in `SPONSORS.md` §2.2:** write search as `POST /assistants/{id}/memories/search { query, limit }`.

### B3. `tools` + `json_output` together — accepted
The call returned 200. The model chose to call the tool first (`REQUIRES_ACTION`), so the JSON answer only arrives after tool outputs are submitted.
**Advice:** the nudge planner should send `json_output: true` with **no tools** (as the plan already has it) so the first response is the JSON.

### B4. Models list — verified
`GET /models?model_type=llm&supports_tools=true` → 200 `{ models: [...], total }`. Each model has `name`, `provider`, `supports_tools`, `supports_json_output`, `context_limit`, costs.
`total` was **13,438**. Use `limit` (and a provider filter such as `GET /models/provider/google`) for the Settings dropdown; do not load everything.
Providers seen: `anthropic`, `aws-bedrock`, `google`, and more. `google` / `gemini-2.5-flash` was used for these tests and handles tool calls.

### B5. Bring your own provider key — not verified
No call tested it. All calls here ran on the Backboard account's own credit balance. Until someone confirms it in the Backboard dashboard or docs, pitch it as "pick any model", not "plug in your own provider key".

### Also verified
`POST /assistants` accepts `custom_fact_extraction_prompt` and `custom_update_memory_prompt` and echoes them back. Response id field is **`assistant_id`**. `DELETE /assistants/{id}` → 200.

---

## ElevenLabs (base `https://api.elevenlabs.io/v1`, header `xi-api-key`)

### E1. Audio tags on `eleven_v4_turbo` — verified
Each tag was sent as `[tag] I found three new emails for you today.` in Chip's voice, then the audio was transcribed with `scribe_v2` to check that the tag was not read aloud.

| Tag | HTTP | Tag read aloud? |
|---|---|---|
| `[cheerful]` `[excited]` `[confident]` `[nervous]` `[whispers]` `[sad]` `[serious]` `[sighs]` `[relieved]` | 200 each | No, for all nine |

What this proves: the model accepts every tag in the §3.3 table and does not speak it. What it does not prove: how strong each emotion sounds. That needs a human listen (Shafeen).
**Change in `SPONSORS.md` §3.3:** remove the ⚠ on the tag words.

### E2. Voice settings — verified
`voice_settings: { stability, style, speed }` (and `similarity_boost`) returned 200 on `eleven_v4_turbo`.

### E3. Timestamps for lip-sync — verified
`POST /text-to-speech/{voice_id}/with-timestamps` (same body as normal TTS) → 200 JSON:
```
{ audio_base64, alignment: { characters[], character_start_times_seconds[], character_end_times_seconds[] }, normalized_alignment: {...} }
```
**Important:** `alignment.characters` includes the audio tag itself (`[`, `e`, `x`, `c`, ... `]`). The voice service must drop the tag's characters before handing alignment to the renderer, and take "first word" timing from the first character after the tag.
Audio arrives as base64 in JSON here, not as raw bytes.

### E4–E6
- `eleven_flash_v2_5` returns 200 for the same line (use without tags).
- Subscription: tier `creator`, status `active`, 131,000 credits per period.
- Voice Design: `POST /text-to-voice/design { model_id: 'eleven_multilingual_ttv_v2', voice_description, text }` returns 3 previews `{ audio_base_64, generated_voice_id }`. `POST /text-to-voice { voice_name, voice_description, generated_voice_id }` returns `voice_id`. Preview text must be at least 100 characters, so the plan's short preview lines are padded in character.

### Key permissions the ElevenLabs key needs
Text to Speech, Speech to Text, Voices (Read; Write to create designed voices), Voice Generation, Sound Effects, Music Generation, Models, User (to read the plan tier).

---

## Tiger Data

### T1. Syntax — verified on TimescaleDB 2.30.2
`scripts/tiger-schema.sql` ran twice with no error: hypertable, `timescaledb.compress` + `add_compression_policy`, `add_retention_policy`, three continuous aggregates with refresh policies, three views, five tables. Events were written and read back through `wolf_audit`, `job_history`, and `user_mood_timeline`.
Notes: continuous aggregates must be created outside a transaction and use `WITH NO DATA`; the daily aggregates need `start_offset` of several days.

### T2. TLS — needs a change in the plan
The Tiger Cloud server certificate is signed by Tiger's own CA (`ca.timescale.com`), which Node does not trust. With default settings `pg` fails with a certificate error.
Fix used: set `TIGER_CA_FILE=<path to CA .pem>` in `.env`; `tigerPoolConfig()` in `scripts/tiger-migrate.ts` passes it as `ssl.ca`. Verification stays on.
The CA file used so far was captured from the server's own handshake. Replace it with the one downloaded from the Tiger Cloud console before the demo.
**Change in `ARCHITECTURE.md` §10:** add `TIGER_CA_FILE=` to the environment list. Everyone who runs against Tiger needs the `.pem`.

---

## Lane S4 notes (sound effects, looping, music)
Verified with real calls on 2026-10-04.
- `POST /sound-generation` with `{ text, model_id: 'eleven_text_to_sound_v2', duration_seconds }` → 200, `audio/mpeg`.
- **Looping is supported:** `loop: true` was accepted for the 25 s forest ambience. Whether the seam is inaudible still needs a human listen; the renderer can crossfade if not.
- `POST /music/compose` with `{ prompt, music_length_ms: 20000, model_id: 'music_v2_5' }` → 200 on the Creator plan (`resources/music/test-calm.mp3`).
- Mood samples of Chip's voice, one per tag, are in `voices/previews/moods/` for listening.
- One extra "poke" (clicked) sound per animal was added beyond the plan's list; playing it on click is the app shell's decision.

---

# Archie (lane W1) — verified 2026-10-04

## A1. Backboard thread documents — verified
| Step | Call | Result |
|---|---|---|
| Create a thread | `POST /assistants/{assistant_id}/threads` body `{}` | 200 `{ thread_id, assistant_id, created_at, ... }` |
| Upload | `POST /threads/{thread_id}/documents`, multipart field `file` | 200 `{ document_id, filename, status: "pending", status_message, summary, created_at }` |
| Status | `GET /documents/{document_id}/status` | 200 `{ document_id, filename, document_type: "thread", status, status_message, file_size_bytes, total_tokens, chunk_count, processing_started_at, processing_completed_at }` |
| Ask | `POST /threads/messages` on the same thread | Response has `retrieved_files: ["<filename>"]` and `retrieved_files_count` |

- Status went `pending` → `indexed`. The chunk count is in **`chunk_count`** (the spec's `{ ok, document_id, chunks }` should map from it).
- **Index time:** an 8-page PDF (38 KB, 40 chunks) took 7.8 s; a 1-page PDF (8 chunks) took 14.6 s. Time is not proportional to size, so keep the 60 s timeout.
- **Answering from the file works:** asked "What does my syllabus say about late work?" and got the correct policy from the uploaded PDF.
- **Limit to know:** answers come from retrieved chunks, not the whole file. In a file made of near-identical filler lines, one planted sentence was not found. Real documents with distinct sections work; "find this one exact line" questions may miss.

## A2. Supported types — verified from the API's own error message
Uploading `.exe` → 400: `File type '.exe' is not supported`. Allowed extensions:
`.aac .avi .bmp .c .cpp .css .csv .doc .docx .flac .gif .go .h .html .java .jpeg .jpg .js .json .jsonl .jsx .m4a .markdown .md .mkv .mov .mp3 .mp4 .mpeg .mpg .ogg .pdf .php .png .ppt .pptx .py .rb .rs .sql .tif .tiff .ts .tsx .txt .wav .webm .webp .xls .xlsx .xml`
`fs_ask_file` should check the extension against this list before uploading. `.txt` upload → 200.

## A3. Maximum file size — not verified
No call tested it (it would mean uploading very large files). The spec's own 20 MB cap in `fs_ask_file` stands until someone confirms Backboard's limit.

## A4. `[softly]` tag — verified
`eleven_v4_turbo` accepted `[softly]` (200) and did not read it aloud (checked by transcribing the audio). How soft it sounds needs a human listen.
