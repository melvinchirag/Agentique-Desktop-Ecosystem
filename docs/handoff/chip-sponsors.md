# Chip sponsor kit — handoff to Melvin

Branch: `chip/sponsors`. Everything here implements the plugs in `src/main/runtime/types.ts` and was run against the real services.

## 1. Get it
```
git fetch && git switch chip/logic && git merge origin/chip/sponsors
npm install            # adds one dependency: pg (+ @types/pg)
```
`package.json` and `package-lock.json` changed (pg only). No file under `src/shared` or `types.ts` was touched.

## 2. Environment (`.env`, never committed; Shafeen shares values privately)
| Variable | What |
|---|---|
| `BACKBOARD_API_KEY` | Backboard key |
| `BB_ASSISTANT_CHIPMUNK` … `BB_ASSISTANT_NIGHTINGALE` | Written by `npx tsx scripts/create-assistants.ts`. Assistants belong to the Backboard account, so use Shafeen's ids with Shafeen's key. |
| `ELEVENLABS_API_KEY` | ElevenLabs key |
| `EL_VOICE_CHIPMUNK`, `EL_VOICE_BEAVER` | Designed voices (others follow). Voices belong to the ElevenLabs account. |
| `TIGER_DATABASE_URL` | Tiger Cloud connection string |
| `TIGER_CA_FILE` | **New.** Path to Tiger's CA certificate (`.pem`), e.g. `.tiger-ca.pem` at the repo root. Without it the connection fails with a certificate error. Not a secret, but keep it out of git. |

## 3. Swap the fakes for the real pieces
```ts
import { join } from 'node:path';
import { BackboardClient } from './src/main/runtime/backboard';
import { BackboardMemoryApi } from './src/main/sponsors/backboardMemory';
import { assistantIdsFromEnv, readEnvFile, voiceIdsFromEnv } from './src/main/sponsors/env';
import { createTigerPool, TigerEventSink } from './src/main/store/tiger';
import { TigerHistoryStore } from './src/main/store/tigerHistory';
import { TigerNudgeStore } from './src/main/store/tigerNudges';
import { TigerQueries } from './src/main/store/tigerQueries';
import { ElevenLabsVoice } from './src/main/voice/elevenlabs';

const root = process.cwd();
const env = { ...readEnvFile(join(root, '.env')), ...process.env };
const assistantIds = assistantIdsFromEnv(env);

const llm      = new BackboardClient({ apiKey: env.BACKBOARD_API_KEY!, defaultModel: { llm_provider: 'google', model_name: 'gemini-2.5-flash' } }); // FakeLlm →
const memories = new BackboardMemoryApi(llm, assistantIds);                    // MemoryApi (Memory screen)
const pool     = createTigerPool(env, root);
const sink     = new TigerEventSink({ db: pool });  sink.attach(bus);          // EventSink, subscribed to the bus
const history  = new TigerHistoryStore(pool);                                  // in-memory history →
const nudgeStore = new TigerNudgeStore(pool);                                  // in-memory nudge storage →
const queries  = new TigerQueries(pool);                                       // Replay, Warden Audit, Pulse
const voice    = new ElevenLabsVoice({ apiKey: env.ELEVENLABS_API_KEY!, voiceIds: voiceIdsFromEnv(env), voiceEnabled: () => settings().voiceEnabled });

// createChipCore({ ..., llm, history, nudgeStore, chipAssistantId: assistantIds.chipmunk! })
// On shutdown: await sink.dispose(); await pool.end();
```

## 4. What each piece does and how it fails
| Piece | Contract | Behaviour when the service is down |
|---|---|---|
| `BackboardClient` | `LlmClient` | 25 s timeout joined with your signal; one retry on network error, timeout, or 5xx; never on 4xx or your abort. Throws `BackboardError` (status + body). |
| `BackboardMemoryApi` | `MemoryApi` (+ `add`) | Throws (the Memory screen should show the error). |
| `TigerEventSink` | `EventSink` | Never throws. Rows go to `<ADE data dir>/pending-events.jsonl` and are retried every 30 s. Drops any event whose payload is over 4 KB (privacy). |
| `TigerHistoryStore` | `HistoryStore` | Returns `[]`. |
| `TigerNudgeStore` | `NudgeStore` | Never throws; falls back to its own in-memory copy. |
| `TigerQueries` | `TigerQueries` (+ `timeline`) | Returns empty results. |
| `ElevenLabsVoice` | `VoiceService` | `speak` falls back to `eleven_flash_v2_5` without the mood tag, then throws if that fails too. `voiceEnabled = false` → empty audio, no credits. |

Things worth knowing:
- `LlmResponse.retrieved_memories` is already plain strings (or `null`). Non-empty → emit `agent.recall`.
- `speak()` returns `alignment` (`characters`, `character_start_times_seconds`, `character_end_times_seconds`) for the spoken text only; the mood tag is stripped.
- `transcribe()` cues come back as scribe writes them, e.g. `[sighs]`, `[laughs]`.
- History row shapes: `recent_tasks { at, asked, answered }`, `warden_blocks { at, agent, tool, rule, reason }`, `agent_activity { agent, jobs, failed, actions }`, `mood_history { day, mood, times, avg_intensity }`. The first two match the in-memory store; the last two come from the daily aggregates.
- Events that share a millisecond are stored 1 microsecond apart so Replay keeps their order.
- Backboard saves a memory 5 to 12 s after the turn, not instantly.
- Memory rules need the `{"facts": [...]}` format block or nothing is saved (`docs/sponsor-verify.md` §B6). `create-assistants.ts` adds it.

## 5. Smoke test
```
npx tsx scripts/tiger-migrate.ts        # once per database; safe to repeat
npx tsx scripts/create-assistants.ts    # once per Backboard account
npx tsx scripts/sponsor-smoke.ts
```
Expected: four `PASS` lines (Backboard tool call, Chip says "On it!", speech-to-text with cues, Tiger 10 events) and `All sponsor checks passed`.

## 6. Not done yet
- Voices exist for Chip and Archie only. `speak()` for another animal throws until its `EL_VOICE_*` is set.
- "Bring your own provider key" on Backboard is not verified.
- The Tiger CA file in use was captured from the server; replace it with the one from the Tiger Cloud console.
- Archie's lanes T1 (file-ops journal) and B1 (thread documents) wait for `contracts/archie`.
