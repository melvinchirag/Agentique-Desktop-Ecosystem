# Lane L7 — Audio: speech queue, lip-sync, chorus, SFX, mic (Codex GPT-6 Luna, high)

Read `docs/lanes/APP-COMMON.md` first.

## Objective
Everything you hear and the mic: one voice at a time by priority, mouth movement from the audio, Swarm's
chorus, sound effects, voice-off mode, and click-and-hold-to-talk that records and sends audio.

## Owned paths
- `src/renderer/audio/**`

## Spec to read
`00-APP-SHELL-SPEC.md` §4 (click-and-hold, short click, mic permission), §6 (lip-sync bullet), §8;
`DECISIONS.md` §5 (speech priority), §9 (ElevenLabs: chorus, voice-off). Contracts: `SpeechQueue`,
`SpeechItem`, `SpeechOutcome`, `SpeechQueueDeps`, `CreateSpeechQueue`, `SfxPlayer`, `CreateSfxPlayer`,
`MicRecorder`, `CreateMicRecorder`, `PushToTalk`, `CreatePushToTalk` in `src/renderer/shell/contracts.ts`;
`Clock` in `src/main/runtime/types.ts`.

## Steps
1. **`speechQueue.ts`** → `createSpeechQueue`:
   - Priority warden > chip > report > ack; FIFO within a priority; **one voice at a time**.
   - `report`/`ack` items waiting more than **8 s** (from enqueue, by the injected clock) are dropped with
     outcome `'dropped'` (check when choosing the next item and with a timer); `warden`/`chip` never drop.
   - Fetch audio with `deps.speak(agentId, text, mood)` as soon as an item is enqueued (≤ 2 fetches in
     flight). Decode with `decodeAudioData`. A rejected `speak` → outcome `'failed'`, move on.
   - **Empty or undecodable buffer = silence**: "virtual" playback lasting `clamp(60 ms × text.length,
     800, 4000)` with a procedural mouth (≈ 8 Hz wobble, 0.2–0.7), so bubbles and Talk timing still work.
   - **Lip-sync**: source → `AnalyserNode` → RMS → smoothed (fast attack ~0.5, slow release ~0.15) →
     0..1 → `deps.setMouth(agentId, v)` at ~30 Hz while speaking; `setMouth(agentId, 0)` at the end.
   - **Swarm chorus** (`agentId === 'ants'`): three sources from the same buffer, detune 0 / +25 / −25 cents,
     start offsets 0 / 15 / 30 ms, each gain ≈ 0.6.
   - Master `GainNode` for `setVolume`. `setVoiceEnabled(false)` stops the current item and ends it and
     every later enqueue immediately with `'muted'`. `clear()` stops the current item and drops the rest
     (`'cleared'`). `onStart`/`onEnd` listeners; `dispose` stops everything and clears timers.
   - Use `deps.audioContext?.()` when given; otherwise create one shared `AudioContext` lazily (and resume
     it if suspended).
2. **`sfx.ts`** → `createSfxPlayer({ baseUrl })`: lazily fetch `${baseUrl}/manifest.json`
   (`{ version: 1, sounds: { [name]: { file: string; volume?: number } } }`), decode and cache on first
   use; unknown name, missing manifest, or fetch/decode error → silent (no throw, one dev warning).
   `setVolume`, `setEnabled`.
3. **`mic.ts`** → `createMicRecorder({ maxMs = 30000 })`: `getUserMedia({ audio: true })`, `MediaRecorder`
   with the first supported of `audio/webm;codecs=opus`, `audio/webm`, `audio/ogg`; auto-stop at `maxMs`;
   `stop()` → `{ audio: ArrayBuffer, mime }` or `null` if empty; always stop the tracks.
4. **`pushToTalk.ts`** → `createPushToTalk({ mic, sendVoice, focusChat, shortClickMs = 250, clock })`:
   `pointerDown` starts recording immediately (so the first words aren't lost) and notes the time;
   `pointerUp` before `shortClickMs` → stop and **discard** the recording, call `focusChat()`; otherwise
   stop and `sendVoice(audio, mime)` when non-null. Guard against double down/up and mic errors (log,
   don't throw).
5. **`index.ts`** re-exports the four factories.

## Tests you must add (write small fakes for AudioContext/AnalyserNode/AudioBufferSourceNode/GainNode/
MediaRecorder/getUserMedia in your test files; fake clock)
Priority order; one at a time; 8 s drop for report/ack only; warden/chip never dropped; failed `speak`
continues; silence fallback duration + mouth; `setMouth(…, 0)` at the end; chorus = 3 sources with the right
detune/offsets; volume; muted; clear; sfx unknown name / missing manifest silent; mic auto-stop at `maxMs`;
push-to-talk short click (focusChat, nothing sent) vs hold (sendVoice called with the bytes).

## Notes for W2a (put in your final message)
How the overlay should create these (deps, base URLs), and how Chip's pointer events map to `PushToTalk`.

## Lane-specific STOP conditions
- The contracts can't express something the speech/mic flow needs.
