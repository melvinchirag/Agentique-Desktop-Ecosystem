# ADE sponsor feature map

ADE (Agentique Desktop Ecosystem) puts 3D animal agents on the real Windows desktop. The user talks only to Chip, who delegates file work to Archie, Google Workspace work to Pixel, web research to Scout, and planning to Swarm. Warden checks specialist tool actions and screens untrusted content. ElevenLabs supplies voices and sound; Backboard supplies reasoning and memory; Tiger Data records activity, history, and follow-ups.

## Overview matrix

| Agent (code name) | ElevenLabs | Backboard | Tiger Data |
|---|---|---|---|
| Chip (`chipmunk`) | Speech-to-text; audio-event cues; expressive TTS; chirps and nudge knocks | Conversation thread; delegation tools; personal memory; recall; JSON nudge planner | Events; `biome_history`; persistent nudges; plan completion lookup |
| Archie (`beaver`) | Own voice; spoken file reports; gnaw, tail-slap, paper sounds | File tools; thread-document Q&A; folder/naming memory | Events and activity; `file_ops` adapter exists, desktop writer **not implemented** |
| Warden (`wolf`) | Serious voice; shipped warning lines; growl/howl | Optional JSON injection classifier; memory off | Verdicts, alerts, approvals; `wolf_audit`; `warden_daily` |
| Pixel (`workspace`) | Own voice; draft reports; blip/stamp sounds | Workspace tools; style learning; memory; Drive/attachment Q&A | Events; `drafts_log` adapter exists, desktop writer **not implemented** |
| Scout (`eagle`) | Own voice; spoken findings; wing-flaps/screech | Built-in web search; research preferences; brief tools | `research_log`; job/activity history |
| Swarm (`ants`) | Own voice; local chorus effect; shipped lines; marching sounds | Planning assistant; `plan_save`; work-habit memory | `plan_items`; plan events; evening completion lookup |

| Reading this map | Meaning |
|---|---|
| **Live** | Connected in the desktop runtime, when required services and assistants are configured. |
| **Script** | Implemented generation, setup, or verification code. Not an automatic desktop action. |
| **Adapter only** | Code exists, but desktop integration is **not implemented**. |
| Review basis | Actual `src/` and `scripts/` code. Both requested branch diffs were read after fetching. Archie PDF fix (#50) and Scout fix (#51) are already merged into the reviewed main revision. |
| Identifiers | Endpoint parameters below are placeholders. Model IDs are literal code values. No account, assistant, voice, or document IDs are disclosed. |

## ElevenLabs — MLH Best Use of ElevenLabs

API paths below are relative to the ElevenLabs `/v1` API.

| Feature (sponsor capability) | API / endpoint / model ID | Which agent(s) | What the agent does with it (concrete) | When it fires (trigger) | Code location (file path) |
|---|---|---|---|---|---|
| **Live:** expressive text-to-speech | `POST /text-to-speech/{voice}/with-timestamps`; `eleven_v4_turbo`; `mp3_44100_128` | All six | Speaks acknowledgements, results, nudges, and security explanations in each agent's voice. | An `agent.say` event reaches the speech queue; no shipped/cache match. | `src/main/voice/elevenlabs.ts`; `src/renderer/overlay/director/index.ts`; `src/renderer/audio/speechQueue.ts` |
| **Live:** audio tags and voice settings | Same TTS endpoint; `stability`, `style`, `speed` | All six | Maps moods to `[cheerful]`, `[excited]`, `[confident]`, `[nervous]`, `[sad]`, `[serious]`, or `[sighs]`. Warden always uses protective delivery. | Each generated spoken line. | `src/main/voice/moodVoice.ts`; `src/main/voice/elevenlabs.ts` |
| **Live:** per-agent voices | TTS `{voice}` selected from `EL_VOICE_*` configuration | All six | Distinct Chip, Archie, Warden, Pixel, Scout, and Swarm voices. | Speech for the corresponding agent. | `src/main/sponsors/env.ts`; `src/main/core/realCore.ts`; `src/main/voice/elevenlabs.ts` |
| **Script:** original Voice Design | `POST /text-to-voice/design`; `eleven_multilingual_ttv_v2`; then `POST /text-to-voice` | All six; also Iris and Celene | Generates character previews from descriptions. A selected preview becomes a permanent voice. No voice cloning call. | `scripts/design-voices.ts --agent …` or `--all`; then `--pick …`. | `scripts/design-voices.ts` |
| **Live:** timestamped audio response | `audio_base64` and character `alignment` from TTS | All speaking agents | Decodes MP3; removes mood-tag characters from alignment; caches audio and timing. Desktop speech currently forwards audio only. | Successful TTS response. | `src/main/voice/elevenlabs.ts`; `src/main/voice/cache.ts`; `src/main/core/realCore.ts` |
| **Live:** Scribe transcription | `POST /speech-to-text`; `scribe_v2` | Chip; user speech enters here | Converts a recorded utterance into the text submitted to Chip. | Release the hold-to-talk control, with voice enabled. | `src/main/voice/elevenlabs.ts`; `src/main/core/realCore.ts`; `src/renderer/audio/pushToTalk.ts`; `src/renderer/hub/ChatTab.tsx` |
| **Live:** non-speech audio events | `tag_audio_events=true`; `words[].type=audio_event` | Chip | Separates cues such as sighs/laughter from spoken words. Passes cues into Chip's mood context. | Scribe returns audio events with the recording. | `src/main/voice/elevenlabs.ts`; `src/main/agents/chipmunk/prompt.ts`; `src/main/runtime/orchestrator.ts` |
| **Script + live playback:** sound generation | `POST /sound-generation?output_format=mp3_44100_128`; `eleven_text_to_sound_v2`; duration and optional `loop` | All six; Iris, Celene, system | Generates animal reactions, handoff sounds, approval dings, and poke reactions. Desktop plays local MP3s from the manifest. | Script creates assets; runtime status, mood, handoff, approval, or click events play mapped sounds. | `scripts/generate-sfx.ts`; `src/renderer/overlay/director/sounds.ts`; `src/renderer/audio/sfx.ts` |
| **Script + live playback:** looping ambience | Same sound-generation endpoint; `loop:true`; 25-second forest asset | Shared desktop biome | Loops forest ambience at reduced gain. | Generated beforehand; ambience enabled in audio settings. | `scripts/generate-sfx.ts`; `src/renderer/audio/sfx.ts`; `src/renderer/audio/settings.ts` |
| **Script:** music composition | `POST /music/compose?output_format=mp3_44100_128`; `music_v2_5`; `music_length_ms:20000` | Celene asset experiment; outside the six core agents | Creates `resources/music/test-calm.mp3`. Agent-triggered composition/playback is **not implemented**. | Run `scripts/generate-sfx.ts --music`. | `scripts/generate-sfx.ts`; `src/main/core/standInSpecialists.ts` |
| **Script + live lookup:** fixed voice lines | Timestamped TTS; `eleven_v4_turbo`; `[growls] [serious]` for selected Warden lines | Warden; Swarm | Script renders 16 Warden and six Swarm templates plus timing files. Exact-text matches play locally without an API call. | Warden verdict/approval/alert speech; any Swarm output matching a shipped line. | `scripts/pregen-lines.ts`; `src/main/voice/cache.ts`; `src/main/wolf/speaker.ts`; `src/main/core/realCore.ts` |
| **Live + helper:** generated-audio reuse | ADE disk cache keyed by voice/model/mood/text; `pregenerate()` helper | All six; Pixel helper script | Reuses generated clips. Pixel's smoke script can prefill stock lines. Automatic startup prewarming is **not implemented**. | Repeat utterance; explicit helper invocation. | `src/main/voice/cache.ts`; `src/main/voice/elevenlabs.ts`; `scripts/pixel-smoke.ts` |
| **Live:** alternate TTS model | Same TTS endpoint; `eleven_flash_v2_5` | All six | Retries speech without audio tags if primary TTS fails. Fallback clips are not cached. | Primary TTS throws or returns an error. | `src/main/voice/elevenlabs.ts` |

### Why this is a strong use

- Speech input carries both words and non-speech cues into Chip's response.
- Separate designed voices make delegation audible. Judges can hear who is working.
- Audio tags connect agent mood to delivery; Warden retains a consistent protective voice.
- Generated effects make security decisions, handoffs, and completed work recognizable.
- Cached and shipped lines avoid repeat API calls. Swarm's chorus is added locally with Web Audio.

### Demo moment

| What to say/do in the demo | What judges see | Sponsor feature shown |
|---|---|---|
| Hold the mic: “I'm stressed. Help me find my latest PDF in Downloads.” | Speech becomes a request; Chip reacts and delegates to Archie. Any detected audio cues accompany the text internally. | Scribe transcription/audio events; mood-conditioned TTS |
| Ask Chip to research something, then ask for a file summary. | Scout and Archie report in distinct voices, with animal sounds around their work. | Per-agent voices; TTS; generated SFX |
| Ask to open a script file through Archie. | Warden blocks the action, growls, and speaks a protective explanation. | Generated SFX; Warden's fixed voice lines |
| Ask Swarm for a plan involving files, research, and a draft. | Swarm speaks with a small chorus effect while presenting a plan. | ElevenLabs voice rendered through local three-voice playback |

### Fallbacks / what happens without it

| Condition | Actual behavior | Code location (file path) |
|---|---|---|
| No `ELEVENLABS_API_KEY`, with other live requirements present | Typed chat remains available. Shipped exact-match lines can still play. Other speech returns empty audio; `sendVoice` returns without submitting a request. | `src/main/core/realCore.ts` |
| Voices disabled | Speech returns empty audio; voice input is ignored. SFX and ambience have separate renderer controls. | `src/main/core/realCore.ts`; `src/renderer/audio/settings.ts` |
| Primary TTS fails | Tries `eleven_flash_v2_5` without tags. If that also fails, the desktop returns silent audio; text bubbles remain. | `src/main/voice/elevenlabs.ts`; `src/main/core/realCore.ts` |
| Agent voice missing | A shipped line may still play. Otherwise voice generation fails and the desktop returns silence. | `src/main/voice/elevenlabs.ts`; `src/main/core/realCore.ts` |
| STT request fails | Error propagates to the recording UI; no alternative STT provider. Use typed chat. | `src/main/voice/elevenlabs.ts`; `src/renderer/hub/ChatTab.tsx`; `src/renderer/audio/pushToTalk.ts` |
| Local sound asset missing | SFX player skips it; loading failures warn once. No runtime regeneration. | `src/renderer/audio/sfx.ts` |

## Backboard — Best Use of Backboard

API paths below are relative to the Backboard `/api` API. Calls use the shared client and non-streaming responses.

| Feature (sponsor capability) | API / endpoint / model ID | Which agent(s) | What the agent does with it (concrete) | When it fires (trigger) | Code location (file path) |
|---|---|---|---|---|---|
| **Script:** assistant lifecycle | `POST /assistants`; `PUT /assistants/{assistant}`; `DELETE /assistants/{assistant}` | All six; Iris/Celene setup; separate Warden Screen | Creates named assistants. Updates memory prompts in place; explicit force mode replaces old assistants. | `create-assistants` setup/update; temporary-assistant cleanup in verification scripts. | `scripts/create-assistants.ts`; `src/main/runtime/backboard.ts`; `scripts/backboard-spike.ts` |
| **Live:** threads and messages | `POST /threads/messages`; `assistant_id`, optional `thread_id`, `system_prompt`, `stream:false` | Chip, Archie, Pixel, Scout, Swarm; Warden Screen | Chip reuses one conversation thread during the runtime. Specialists start a fresh thread per job. Prompts/tools travel with requests. | User turn, specialist job, result turn, nudge, or classifier request. | `src/main/runtime/backboard.ts`; `src/main/runtime/orchestrator.ts`; `src/main/runtime/agentRuntime.ts` |
| **Live:** tool calling and continuations | `tools`; `REQUIRES_ACTION`; `POST /threads/tool-outputs` | Chip and four specialists | Chip delegates/reports mood/queries history. Specialists run registered tools after local checks and approvals. Returns an output for every call. | Model requests functions; executors return results. | `src/main/runtime/backboard.ts`; `src/main/runtime/orchestrator.ts`; `src/main/runtime/agentRuntime.ts` |
| **Live:** automatic assistant memory | `/threads/messages`, `memory:'Auto'` | Chip, Archie, Pixel, Scout, Swarm | Retains useful preferences across threads on each assistant. | Chip user turns; normal specialist jobs; Swarm also uses Auto for help jobs. | `src/main/runtime/orchestrator.ts`; `src/main/runtime/agentRuntime.ts`; `src/main/chipCore.ts` |
| **Live:** read-only memory | `/threads/messages`, `memory:'Readonly'` | Chip; Archie, Pixel, Scout on help jobs | Uses remembered context without automatic fact writes from internal results or follow-ups. | Chip result/nudge/recovery turns; specialist help jobs except Swarm. | `src/main/runtime/orchestrator.ts`; `src/main/runtime/agentRuntime.ts` |
| **Live:** memory disabled | `/threads/messages`, `memory:'off'` | Warden Screen; Chip nudge planner; Pixel style learner | Keeps these classifier/analysis requests out of automatic memory extraction. This is not thread deletion. | Classifier, calendar-nudge planning, email-style analysis. | `src/main/sponsors/wardenClassifier.ts`; `src/main/runtime/nudges.ts`; `src/main/agents/workspace/style/learner.ts` |
| **Script-configured:** custom fact extraction and updates | `custom_fact_extraction_prompt`; `custom_update_memory_prompt`; `{"facts":[…]}` | Chip, Archie, Pixel, Scout, Swarm; Iris/Celene setup | Installs the role-specific rules below. Prompts exclude untrusted content and request updates rather than duplicates. | Assistant setup/update; subsequent Auto-memory turns. | `scripts/create-assistants.ts`; `src/main/sponsors/memoryFormat.ts`; rule files below |
| **Live:** inspect and search memories | `GET /assistants/{assistant}/memories`; `POST …/memories/search` (`query`, limit 20) | Installed agents except Warden in Hub | User selects an animal and reads/searches its actual saved memories. | Open Hub → Memories; submit a search. | `src/main/sponsors/backboardMemory.ts`; `src/main/core/realCore.ts`; `src/renderer/hub/MemoriesTab.tsx` |
| **Live:** edit, erase, and explicitly add memories | `PUT` / `DELETE …/memories/{memory}`; `POST …/memories` | Hub memory owners; Pixel style mirror | Hub edits/deletes a fact. Pixel adds or updates one compact style memory and removes duplicates. Maintenance script can erase memories. | User edits/deletes; successful style learning; explicit maintenance script. | `src/main/sponsors/backboardMemory.ts`; `src/main/agents/workspace/style/styleStore.ts`; `scripts/wipe-memories.ts` |
| **Live:** retrieved-memory visibility | `retrieved_memories` response field → `agent.recall` | Chip | Emits actual recalled memory texts; overlay sparkles. Hub can show recalled texts when its saved-memory list is empty. Specialist recall-event emission is **not implemented**. | Chip response contains nonempty retrieved memories. | `src/main/runtime/backboard.ts`; `src/main/runtime/orchestrator.ts`; `src/renderer/hub/MemoriesTab.tsx`; `src/renderer/overlay/director/index.ts` |
| **Live:** built-in web search | `/threads/messages`, `web_search:'Auto'` | Scout | Researches via Backboard; can open a source URL or save a Markdown brief. Plain query-string citation links no longer trigger the image-exfiltration heuristic. | Chip delegates research; Scout's definition enables search. | `src/main/agents/eagle/index.ts`; `src/main/agents/eagle/tools.ts`; `src/main/runtime/agentRuntime.ts`; `src/main/wolf/injection.ts` |
| **Live:** thread documents and indexing | `POST /threads/{thread}/documents` (multipart file); `GET /documents/{document}/status` | Archie | `fs_ask_file` uploads the located file to its job thread, waits for indexing, then lets the tool continuation answer from it. PDF/Word/slides/sheets requests continue beyond metadata. | User asks Chip to read/summarize a supported local file. | `src/main/sponsors/backboardDocuments.ts`; `src/main/agents/beaver/readTools.ts`; `src/main/agents/beaver/prompt.ts` |
| **Live:** cloud-file and attachment Q&A | Same thread-document upload/status endpoints | Pixel | `drive_ask_file` uploads supported Drive files or text exports of Docs/Slides. `gmail_ask_attachment` uploads allowed email attachments through temporary files. | Chip delegates a question about Drive content or an attachment; Google connected. | `src/main/agents/workspace/driveTools.ts`; `src/main/agents/workspace/gmailTools.ts`; `src/main/agents/workspace/tempFile.ts` |
| **Live:** structured security classification | `/threads/messages`, `json_output:true`, memory off; Warden's selected model | Warden Screen | Returns injection/confidence/reason JSON for borderline text. Fresh thread; 4,000-character input cap; three-second deadline. Deterministic tool policy remains separate. | Heuristic score is at least 0.3 and below 0.6; classifier configured/enabled. | `src/main/sponsors/wardenClassifier.ts`; `src/main/wolf/injection.ts`; `src/main/core/realCore.ts` |
| **Live:** structured nudge planning | `/threads/messages`, `json_output:true`, memory off | Chip | Picks before/after follow-ups for important events in the next seven days; validates event references and future times. | Startup/local midnight with calendar events; retries a failed planner after one hour. | `src/main/runtime/nudges.ts` |
| **Live:** structured email-style learning | `/threads/messages`, `json_output:true`, memory off, web search off | Pixel | Cleans/redacts up to 100 sent messages; validates style JSON; saves a compact Backboard memory and local profile. | Google connection or Learn Email Style, when not already learned. | `src/main/agents/workspace/style/learner.ts`; `src/main/agents/workspace/style/styleStore.ts`; `src/main/core/realCore.ts` |
| **Live:** provider/model choice per agent | `llm_provider`, `model_name`; defaults `openai/gpt-4o` | Chip, specialists, Warden Screen | Settings persists per-agent choices. Fixed options: `gpt-4o`, `gpt-4o-mini`, `claude-sonnet-4-20250514`, `gemini-2.5-pro`. Tool continuations retain their original run's model. | Settings change affects subsequent message requests. | `src/renderer/hub/SettingsPanel.tsx`; `src/main/core/modelPreferences.ts`; `src/main/core/realCore.ts`; `src/main/runtime/backboard.ts` |
| **Script:** model discovery and explicit thread creation | `GET /models?model_type=llm&supports_tools=true&limit=…`; optional `/models/provider/{provider}` wrapper; `POST /assistants/{assistant}/threads` | Developer verification; Archie fixture | Spike lists tool-capable models. Archie smoke script creates a thread before uploading a PDF. Scripts commonly select `google/gemini-2.5-flash`. Dynamic Settings discovery is **not implemented**. | Explicit script invocation. | `scripts/backboard-spike.ts`; `scripts/archie-smoke.ts`; `scripts/backboard-verify.ts`; `src/main/runtime/backboard.ts` |
| **Adapter only:** thread deletion | `DELETE /threads/{thread}` | No current runtime caller | Client method exists. Automatic deletion of style-learning or document-job threads is **not implemented**. | No call site in `src/` or `scripts/`. | `src/main/runtime/backboard.ts`; `src/main/agents/workspace/style/learner.ts` |

| Assistant | Custom memory focus | Rule file |
|---|---|---|
| Chip | Name, school/work, relationships, dated events/outcomes, ADE preferences, goals | `src/main/agents/chipmunk/memory-rules.ts` |
| Archie | Folder purposes, naming conventions, organizing preferences | `src/main/agents/beaver/memory-rules.ts` |
| Pixel | Contacts/roles, recurring meetings, draft preferences from task text only | `src/main/agents/workspace/memory-rules.ts` |
| Scout | Interests, location context, stated budgets, trusted sources | `src/main/agents/eagle/memory-rules.ts` |
| Swarm | Focus hours, work blocks, goals, typical task duration | `src/main/agents/ants/memory-rules.ts` |
| Warden | No memory prompts; classifier requests use memory off | `src/main/agents/wolf/memory-rules.ts`; `src/main/sponsors/wardenClassifier.ts` |
| Iris / Celene (setup only) | Social voice/topics / music taste. Live specialist behavior is **not implemented**. | `src/main/agents/butterfly/memory-rules.ts`; `src/main/agents/nightingale/memory-rules.ts` |

### Why this is a strong use

- One assistant per role keeps useful personal context separate from each job's thread.
- Tool-call continuations connect reasoning to file, Workspace, research, and planning actions.
- Auto, Readonly, and off modes distinguish user conversation from internal analysis.
- Memory has a user-visible manager with search, editing, and deletion.
- Built-in search and indexed thread documents support both web research and private-file questions.

### Demo moment

| What to say/do in the demo | What judges see | Sponsor feature shown |
|---|---|---|
| Tell Chip a harmless preference. After it appears in Memories, ask about that preference again. | Saved fact is visible and editable; Chip may emit a recall sparkle when Backboard returns it. | Persistent memory; returned recall evidence; memory CRUD |
| “Read the latest PDF in Downloads and summarize it.” Use a supported file below 20 MB. | Archie locates the full path, uploads/indexes the document, then returns a content-based summary. | Tool loop; thread-document Q&A |
| “Research this topic online and save a brief with sources.” | Scout leaves to research; a brief artifact points to `Documents/ADE Research`. | Built-in web search; tool continuations |
| Connect Google, learn email style, then ask for a draft. | Pixel produces a reviewable Gmail draft using the saved style profile. | JSON analysis; explicit style memory; Workspace tools |
| Change Chip's model in Settings, then make a new request. | A persisted per-agent model choice; subsequent calls use that provider/model request. | Model routing through one Backboard client |

### Fallbacks / what happens without it

| Condition | Actual behavior | Code location (file path) |
|---|---|---|
| Missing Backboard key or Chip assistant | Missing-credentials demo core starts with a warning. Live text/voice requests reject; saved-memory reads are empty and edits reject. | `src/main/core/realCore.ts` |
| Network timeout or server error | Client retries once for network/timeouts/5xx, not 4xx or caller abort. Specialist runtime also has its own retry wrapper. Exhausted Chip calls show the “brain's a bit foggy” response. | `src/main/runtime/backboard.ts`; `src/main/runtime/agentRuntime.ts`; `src/main/runtime/orchestrator.ts` |
| Specialist missing its runtime prerequisites | Unregistered specialists use preview stand-ins. They do not prove real file, Google, or web execution. | `src/main/core/realCore.ts`; `src/main/core/standInSpecialists.ts`; `src/main/chipCore.ts` |
| Warden classifier missing, slow, or malformed | Local heuristic result remains. The deterministic tool gate still operates. Borderline text is not automatically promoted to a block on classifier failure. | `src/main/wolf/injection.ts`; `src/main/sponsors/wardenClassifier.ts` |
| File upload/indexing fails | Archie returns an explicit error and suggests `fs_read_text` where possible. There is no local PDF-text fallback. Pixel reports upload/index errors. | `src/main/agents/beaver/readTools.ts`; `src/main/agents/workspace/driveTools.ts`; `src/main/agents/workspace/gmailTools.ts` |
| Style JSON fails validation | Learner tries twice, then uses computed writing statistics. Saving still requires the Backboard memory mirror; remote-memory failure can prevent saving the local profile. | `src/main/agents/workspace/style/learner.ts`; `src/main/agents/workspace/style/styleStore.ts` |
| Calendar planner unavailable | Retries after one hour. Deterministic daily/evening/weekly nudge scheduling remains; spoken live conversation still needs Backboard. | `src/main/runtime/nudges.ts`; `src/main/runtime/orchestrator.ts` |

## Tiger Data — Best Use of Tiger Data

Tiger integration uses PostgreSQL through `pg`, plus TimescaleDB hypertables, policies, and continuous aggregates. Schema features require the migration to have been applied.

| Feature (sponsor capability) | API / endpoint / model ID | Which agent(s) | What the agent does with it (concrete) | When it fires (trigger) | Code location (file path) |
|---|---|---|---|---|---|
| **Live:** verified PostgreSQL connection | `pg.Pool`; TLS `rejectUnauthorized:true`; optional `TIGER_CA_FILE` | Shared runtime | Connects to Tiger with verified TLS; four-connection pool and ten-second connection timeout. | Live-core startup. | `src/main/store/tiger.ts`; `src/main/core/realCore.ts` |
| **Schema + live:** event hypertable | `create_hypertable('biome_events', by_range('ts'))`; JSONB payload; task/type indexes | All six | Records user requests, speech, moods, jobs, tool results, approvals, and nudges. Adds sub-millisecond ordering for same-time events. | Bus subscription; flush every 500 ms, up to 200 rows per insert. | `scripts/tiger-schema.sql`; `src/main/store/tiger.ts`; `src/main/chipCore.ts` |
| **Schema:** compression | `timescaledb.compress`; segment by `agent_id`; `add_compression_policy` | All event-producing agents | Configures compression of event chunks older than seven days. | Database policy after schema migration. | `scripts/tiger-schema.sql` |
| **Schema:** raw-event retention | `add_retention_policy('biome_events', INTERVAL '90 days')` | All event-producing agents | Configures removal of old raw event chunks. Feature tables do not receive this policy. | Database retention job. | `scripts/tiger-schema.sql` |
| **Schema + live queries:** activity aggregate | `agent_activity_5m`; `time_bucket('5 minutes', ts)` | All six | Counts events and tool results per agent. Used by Pulse's response and Chip's activity-history tool. | Refresh each minute over the preceding day, ending one minute behind; real-time recent rows enabled. | `scripts/tiger-schema.sql`; `src/main/store/tigerQueries.ts`; `src/main/store/tigerHistory.ts` |
| **Schema + live queries:** mood aggregate | `mood_daily`; daily count and average intensity | Chip/user mood | Powers Mood This Week and mood-history answers. | Five-minute refresh over seven days, ending one minute behind; real-time recent rows enabled. | `scripts/tiger-schema.sql`; `src/main/store/tigerQueries.ts`; `src/main/store/tigerHistory.ts`; `src/renderer/hub/PulseTab.tsx` |
| **Schema + live queries:** job aggregate | `job_stats_daily`; daily done/failed counts by agent | Specialist jobs; Chip reads results | Powers completed-jobs bars and activity summaries. | Same seven-day/five-minute policy; real-time recent rows enabled. | `scripts/tiger-schema.sql`; `src/main/store/tigerQueries.ts`; `src/main/store/tigerHistory.ts`; `src/renderer/hub/PulseTab.tsx` |
| **Schema + live queries:** security aggregate | `warden_daily`; daily counts by rule/verdict | Warden | Counts allowed, asked, denied, and alerted events. Hub displays blocks and inquiries. | Same seven-day/five-minute policy; real-time recent rows enabled. | `scripts/tiger-schema.sql`; `src/main/store/tigerWarden.ts`; `src/renderer/hub/PulseTab.tsx` |
| **Schema + live:** security audit view | `wolf_audit`; lateral join to matching `tool.request` by `callId` | Warden; requesting agent | Associates verdicts/alerts/approval outcomes with requester, tool, rule, and reason. | Hub Audit or Chip's `warden_blocks` history query. | `scripts/tiger-schema.sql`; `src/main/store/tigerWarden.ts`; `src/main/store/tigerQueries.ts`; `src/renderer/hub/AuditTab.tsx` |
| **Schema only:** additional history views | `job_history`; `user_mood_timeline` | Jobs; Chip/user mood | Defines convenient SQL projections of job transitions and mood records. Direct desktop consumers are **not implemented**. | Migration creates views; explicit SQL can read them. | `scripts/tiger-schema.sql` |
| **Live:** persistent nudges | `nudges`; insert/update/due queries; unique `(event_id, kind)` | Chip | Stores custom reminders and rule/calendar follow-ups, including state and ask time. Deduplicates event/kind pairs. | Scheduling, firing, answering, snoozing, cancelling; due check every 30 seconds. | `src/main/store/tigerNudges.ts`; `src/main/runtime/nudges.ts`; `src/main/runtime/orchestrator.ts` |
| **Live:** saved plan items | `plan_items`; parameterized inserts; `today()` / `completionToday()` | Swarm; Chip | Saves goal, ordered task titles, local plan date, and planned state. Chip's evening nudge reads completion totals. Automatic step-completion updates are **not implemented**. | Swarm calls `plan_save`; evening nudge fires. | `src/main/store/tigerPlans.ts`; `src/main/agents/ants/tools.ts`; `src/main/core/realCore.ts`; `src/main/runtime/nudges.ts` |
| **Live:** saved research | `research_log`; JSONB `sources`; `ILIKE` lookup | Scout; Chip | Saves successful result summaries and brief paths. Current wiring puts `[summary]` in `sources`, or `[]` for brief-path records; no structured citation extraction. | Scout succeeds or saves a brief; Chip asks for Scout activity. | `src/main/store/tigerResearch.ts`; `src/main/core/realCore.ts`; `src/main/chipCore.ts`; `src/main/store/tigerHistory.ts` |
| **Adapter + script:** file-operation journal | `file_ops`; record/batch/recent/undo/sweep queries | Archie | Implements a Tiger journal copy and activity counts. Desktop supplies only the local journal; Tiger mirroring is **not implemented** there. | `scripts/archie-smoke.ts`; optional `tigerJournal` injection into ChipCore. | `src/main/store/tigerFileOps.ts`; `src/main/connectors/fs/compositeJournal.ts`; `src/main/chipCore.ts`; `src/main/core/realCore.ts`; `scripts/archie-smoke.ts` |
| **Adapter + script; live count query:** draft metadata | `drafts_log`; upsert by Gmail draft; state/waiting queries; `pixelToday()` | Pixel | Stores recipient count, short subject, timestamp, and state. Desktop draft writer is **not implemented**; Pulse backend still queries counts. | `scripts/pixel-smoke.ts` writes; `getPulse()` reads. | `src/main/store/tigerDrafts.ts`; `src/main/store/tigerQueries.ts`; `src/main/core/realCore.ts`; `scripts/pixel-smoke.ts` |
| **Live:** natural-language activity history | Chip tool `biome_history`: `recent_tasks`, `warden_blocks`, `agent_activity`, `mood_history` | Chip, querying all agents | Executes fixed parameterized SQL, never model-written SQL. Default lookback 24 hours; each SQL template limits to 20 rows. Scout findings may be appended. | “What did you do today?” or “What did Warden block?” | `src/main/agents/chipmunk/tools.ts`; `src/main/runtime/orchestrator.ts`; `src/main/store/tigerHistory.ts` |
| **Live:** task timeline and replay | `SELECT … FROM biome_events` by time range or task | All six; Hub/overlay | Hub lists tasks from the last 24 hours. Replay fetches ordered persisted events and replays desktop choreography at 2× speed. It does not rerun tools. | Open Timeline or Audit, then Replay a task. | `src/main/store/tigerQueries.ts`; `src/renderer/hub/TimelineTab.tsx`; `src/renderer/hub/AuditTab.tsx`; `src/renderer/overlay/director/index.ts` |
| **Live:** Pulse dashboard | `getPulse()` → aggregate queries and draft/security counts | All six; Hub | Displays weekly mood, completed jobs per agent, and Warden blocks/asks. Activity and Pixel counts are returned by the backend but not rendered in this tab. | Open Pulse; data loads on tab mount. | `src/main/store/tigerQueries.ts`; `src/renderer/hub/PulseTab.tsx` |
| **Live:** buffered event persistence | Batched `INSERT … jsonb_to_recordset`; local `pending-events.jsonl` | All event-producing agents | Spools failed event writes to disk and retries every 30 seconds. Drops invalid IDs or payloads over 4,096 bytes. | Event insert failure; periodic retry. | `src/main/store/tiger.ts` |
| **Script:** repeatable schema deployment | PostgreSQL DDL; Timescale extension/version and object queries | Shared infrastructure | Applies schema statements individually; supports a named test schema. No automatic startup migration. | Explicit `scripts/tiger-migrate.ts` invocation. | `scripts/tiger-migrate.ts`; `scripts/tiger-schema.sql` |

### Why this is a strong use

- One event stream connects visible desktop behavior to queryable task history.
- Time-based aggregates answer practical questions about work, mood, and security activity.
- The audit view joins decisions to the agent and tool that requested them.
- Persisted events drive replay; judges can inspect how a task unfolded.
- Nudges, research, and saved plans make the database useful beyond analytics.

### Demo moment

| What to say/do in the demo | What judges see | Sponsor feature shown |
|---|---|---|
| Complete a file lookup and a web research request. Then open Pulse. | Completed-job bars, mood records, and security counts from stored events. | Hypertable; continuous aggregates |
| Trigger an Archie script-open denial, then open Audit. | Requesting agent, blocked tool, rule, reason, and a replay button. | `wolf_audit` join; persisted security events |
| Open Timeline and replay a completed task. | Desktop reenacts the saved task at 2× speed with a replay banner. | Ordered event queries; persistent task history |
| Ask “What did Scout research today?” | Chip can summarize saved Scout findings through the history tool. | `research_log`; parameterized `biome_history` |
| Schedule a short reminder, restart before it is due, and leave nudges enabled. | Chip can recover the persisted reminder and ask when due, subject to quiet hours/busy limits. | Persistent `nudges` state |

### Fallbacks / what happens without it

| Condition | Actual behavior | Code location (file path) |
|---|---|---|
| No Tiger URL, malformed URL, or missing URL credentials | Live-core precheck switches to the warning/demo core. Live chat/voice reject. This is different from a connection outage after configuration. | `src/main/core/realCore.ts` |
| Tiger unreachable during event writes | Events spool to local JSONL and retry every 30 seconds. A local disk-write failure is logged; durable recovery is then not guaranteed. | `src/main/store/tiger.ts` |
| Tiger queries fail | Timeline/task/audit return empty arrays; aggregate/count queries return empty data or zeros. This can look like no recorded activity. | `src/main/store/tigerQueries.ts`; `src/main/store/tigerWarden.ts`; `src/main/store/tigerDrafts.ts` |
| Nudge/plan/research SQL fails | Stores fall back to current-process copies for failed reads. Failed feature-table writes have no durable retry queue; successful later reads favor the database. | `src/main/store/tigerNudges.ts`; `src/main/store/tigerPlans.ts`; `src/main/store/tigerResearch.ts` |
| Optional file/draft mirror fails | Adapter errors are logged; reads are empty and failed writes are dropped. Archie's actual desktop undo uses the local journal. | `src/main/store/tigerFileOps.ts`; `src/main/store/tigerDrafts.ts`; `src/main/connectors/fs/compositeJournal.ts`; `src/main/core/realCore.ts` |
| Certificate verification fails | Verification remains enabled; queries fail. An unreadable configured CA file can throw during pool setup. | `src/main/store/tiger.ts`; `scripts/tiger-migrate.ts` |

## Known limits (honest)

| Area | Implemented boundary / limitation | Evidence (file path) |
|---|---|---|
| Review scope | Source review only. No build, tests, migrations, generation scripts, or live sponsor calls were run for this document. Code support is not a claim that credentials or remote schema are currently valid. | `src/main/core/realCore.ts`; `scripts/tiger-migrate.ts` |
| Shipped fixes | Archie is instructed to read actual contents using full paths. Scout citations with query parameters no longer match the image-only exfiltration rule. Chip recovers from some promise-only replies; this is not a guarantee against every model error. | `src/main/agents/beaver/prompt.ts`; `src/main/wolf/injection.ts`; `src/main/runtime/orchestrator.ts` |
| Demonstration mode | Demo core and specialist stand-ins can produce animations and preview artifacts without real sponsor-backed work. Verify live configuration before judging. Iris/Celene have setup/assets, but real specialist implementations are **not implemented**. | `src/main/core/realCore.ts`; `src/main/core/standInSpecialists.ts` |
| ElevenLabs model names | Primary TTS in code is `eleven_v4_turbo`, not `eleven_v3`. Availability is determined by the API response; code falls back to `eleven_flash_v2_5`. | `src/main/voice/elevenlabs.ts` |
| Timestamp-driven lip sync | API alignment is cached, but forwarding it through desktop speech IPC is **not implemented**. Mouth movement uses audio amplitude; silent fallback uses synthetic movement. | `src/main/core/realCore.ts`; `src/renderer/audio/speechQueue.ts` |
| Music and fixed lines | Live Celene composition/playback is **not implemented**. Swarm stock clips are exact-text lookups, not a dedicated trigger dispatcher for all six generated lines. | `scripts/generate-sfx.ts`; `scripts/pregen-lines.ts`; `src/main/voice/cache.ts`; `src/main/chipCore.ts` |
| Memory controls | Fact-extraction restrictions are prompts, not a proof of perfect filtering. Only Chip emits live retrieved-memory events. Warden is omitted from the Hub memory picker. | `src/main/agents/workspace/memory-rules.ts`; `src/main/runtime/agentRuntime.ts`; `src/main/runtime/orchestrator.ts`; `src/renderer/hub/MemoriesTab.tsx` |
| Memory off and deletion | Memory off does not delete messages/files. Automatic thread cleanup is **not implemented**. Pixel's style-cache `sync()` exists but has no startup caller; deleting its remote style memory does not automatically erase the local profile. | `src/main/runtime/backboard.ts`; `src/main/agents/workspace/style/learner.ts`; `src/main/agents/workspace/style/styleStore.ts`; `src/main/core/realCore.ts` |
| Model discovery | Per-agent Settings changes are live, but the dropdown is fixed. Populating it from Backboard's models endpoint is **not implemented**. | `src/renderer/hub/SettingsPanel.tsx`; `scripts/backboard-spike.ts` |
| File Q&A | Upload cap is 20 MB; indexing has a 60-second polling budget and per-request timeouts. Local text preview handles plain text only. Binary document contents are not locally screened before upload; returned specialist summaries are screened. | `src/main/sponsors/backboardDocuments.ts`; `src/main/agents/beaver/readTools.ts`; `src/main/runtime/agentRuntime.ts` |
| Search citations | Backboard response conversion does not retain separate citation/search metadata. Scout relies on answer text/links; `research_log.sources` currently stores summary text or an empty array. | `src/main/runtime/backboard.ts`; `src/main/core/realCore.ts`; `scripts/backboard-verify.ts` |
| Security classifier | Optional second layer sees only the first 4,000 characters of borderline text. Timeout/failure preserves the heuristic decision; it is not a universal injection detector. | `src/main/sponsors/wardenClassifier.ts`; `src/main/wolf/injection.ts` |
| Swarm plans | Saves two-to-six-step plans; it does not execute them itself. Runtime calls to `markStep()` are **not implemented**, so evening completion is not automatically updated from finished jobs. | `src/main/agents/ants/tools.ts`; `src/main/store/tigerPlans.ts`; `src/main/runtime/nudges.ts` |
| Tiger file/draft integration | Desktop writes to `file_ops` and `drafts_log` are **not implemented**. Adapters and smoke scripts exist. Do not present those tables as automatically populated by a desktop demo. | `src/main/core/realCore.ts`; `scripts/archie-smoke.ts`; `scripts/pixel-smoke.ts` |
| Event privacy and retention | Some tool arguments are redacted; large events are dropped. Events still include user text and summaries. This is not full content redaction. Only raw `biome_events` has the 90-day policy. | `src/main/runtime/agentRuntime.ts`; `src/main/runtime/redactArgs.ts`; `src/main/store/tiger.ts`; `scripts/tiger-schema.sql` |
| Dashboard scope | Pulse shows mood, jobs, blocks, and asks. Rendering its returned activity/Pixel metrics is **not implemented**. Hub tabs fetch on mount; they are not continuously refreshing dashboards. | `src/renderer/hub/PulseTab.tsx`; `src/renderer/hub/AuditTab.tsx`; `src/renderer/hub/TimelineTab.tsx` |
