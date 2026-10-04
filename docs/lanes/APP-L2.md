# Lane L2 — FakeCore, demo scripts, EventPlayer (Codex GPT-6 Luna, medium)

Read `docs/lanes/APP-COMMON.md` first.

## Objective
A believable fake core that answers every `window.ade` call and plays the 10 demo scripts through the same
`ade:event` stream the real Chip core will use, plus the `EventPlayer` used by the scripts and by Replay.
These scripts are also the **backup demo** if the network dies, so they must look real.

## Owned paths
- `src/main/fake/**` (replace Wave 0's stub `index.ts`)
- `src/main/ipc/registerCoreIpc.ts` (+ its test) — refine only if needed
- `resources/fake/**`

## Spec to read
`00-APP-SHELL-SPEC.md` §7 (what each event makes the animals do), §11, §12; `ARCHITECTURE.md` §3.2
(`BiomeEvent`), §3.4 (`AdeApi`); `DECISIONS.md` §5–§8 (behaviors: handoffs, help jobs, parallel jobs, ants,
moods, sleep/dock timers, nudges). Contracts: `CoreAdapter`, `CreateFakeCore`, `FakeCoreOptions`,
`EventPlayer`, `CreateEventPlayer` in `src/main/shell/contracts.ts`; `BiomeEventInput`, `Clock` in
`src/main/runtime/types.ts`; `EventBus` in `src/main/bus/eventBus.ts`.

## Steps
1. **`src/main/fake/eventPlayer.ts`**: `createEventPlayer: CreateEventPlayer`, exactly per the contract.
   Pure TS: **no Electron, DOM, or Node imports** (the renderer bundles it for Replay). Default clock =
   `globalThis.setTimeout/clearTimeout` + `Date.now`. One timer at a time (schedule the next item only).
   `load` sorts by `atMs` (stable). `setSpeed` mid-play reschedules the remaining items; pause/resume keeps
   the remaining delay; `stop` → `idle` without `onDone`; after the last item → `done` + `onDone`.
2. **Scripts** in `src/main/fake/scripts/<name>.ts`, each exporting a typed `DemoScript`
   (define the type in `src/main/fake/types.ts`: `{ name; keywords: string[]; steps: { atMs: number;
   event: BiomeEventInput }[] }`, with a way to express the approval branch below). At play time FakeCore
   stamps one fresh `taskId` per run onto every event and makes `jobId`/`callId` unique per run.
   Use only valid `AgentId`s and exact event shapes. Agent ids: chipmunk (Chip), workspace (Pixel), wolf
   (Warden), beaver (Archie), eagle (Scout), ants (Swarm), butterfly (Iris), nightingale (Celene).
   Spoken `text` is ~10 words; `bubble` is 1–2 words (optional emoji).
   - `boot`: `agent.presence` active/`startup` for each core animal, 150 ms apart; extras `not_installed`
     (or `sleeping` if `settings.installed[id]`); Chip `agent.say` hello (`priority: 'chip'`).
   - `email-digest` (keywords: email, inbox, digest, mail): `user.message` → Chip `agent.status` thinking →
     Chip ack say (`ack`) → `agent.handoff` chip→workspace → `job.update` queued→running →
     workspace status working (`detail: 'Reading 12 emails…'`) → `tool.request` (`gmail_search`, risk
     `read`) → `wolf.verdict` allow → `tool.result` ok → `artifact` `email_digest` → job done →
     `agent.return` → Pixel report say (`report`) → Chip summary say (`chip`) → statuses back to idle.
   - `parallel` (pizza, and): two handoffs at once: Scout (`eagle`, status `away` while browsing, returns
     with a `research_brief`) and Pixel (an `email_draft` with `openUrl: 'https://mail.google.com/'`).
   - `angry-relief` (angry, ugh, hate, why): `user.mood` angry 0.9 → Chip `agent.mood` scared, then the
     other active animals catch it 400 ms later, 250 ms apart (Warden `protective`, others scared/nervous);
     later a "thanks" turn → `user.mood` happy → Chip `relieved`, Warden `proud`, others `happy`;
     20 s after the last mood change everyone goes `neutral`.
   - `warden-block` (send it, send): `tool.request` `gmail_send` risk `external` → `wolf.verdict` deny
     (`rule: 'W1'`) → Warden `agent.mood` protective → Warden say (`warden`) "I stopped that. ADE never
     sends email." → Chip say.
   - `approval` (trash, delete, clean): Archie (`beaver`) `tool.request` `fs_trash` risk `destructive` →
     `wolf.verdict` ask → `approval.request` (`title: 'Move 12 files to ADE Trash?'`, a preview list).
     The script **pauses** until `resolveApproval(callId, approved)`: approved → `approval.resolve` true,
     `tool.result` ok, Archie report say, `artifact` `file_plan`; denied → `approval.resolve` false,
     `tool.result` false ("Cancelled by you"), Chip say.
   - `ant-plan` (report, plan, notes): Melvin's task "Turn the notes on my desktop into a report with 3
     sources": handoff chip→ants (Swarm plans; `artifact` `day_plan`) → `agent.return` → three
     `agent.handoff`s with `via: 'ants'` to beaver (read notes), eagle (3 sources, status `away`),
     workspace (write the Doc), each with job updates and a report say → Chip summary.
     Include one **help job**: `job.update` with `requestedBy: 'workspace'`, `to: 'beaver'`.
   - `sleep-dock-wake` (sleep, nap): Archie `agent.presence` sleeping (`idle_timeout`) at
     `timers.sleepAfterSec`, docked (`dock_timeout`) at `timers.dockAfterSec` (demo: 30 s / 60 s; read the
     current settings when the script starts). Waking is real: `wakeAgent(id)` → presence active
     (`reason: 'user'`).
   - `nudge` (nudge, remind): `nudge.fire` (`kind: 'custom'`, about "How did the midterm go?") + Chip say.
     `demoFireNudge()` plays this script.
   - `recall` (remember, last time): `user.message` → `agent.recall` (2 memories) → Chip say using one.
3. **`src/main/fake/index.ts`**: `createFakeCore: CreateFakeCore`. Owns an `EventBus`; `subscribe`
   delegates to it. Several scripts may run at once (one player per run); a script's events go through
   `bus.emit`. Behavior per method:
   - `start()` → `boot`. `dispose()` stops every player.
   - `sendMessage(text)` → emit `user.message`, pick a script by keyword (case-insensitive); no match → a
     short fallback (Chip `thinking` → ack say "On it!" → Chip say "In the full app I'd hand that to the
     right animal.").
   - `sendVoice(audio, mime)` → like `sendMessage('(voice message)', 'voice')` → `email-digest`.
   - `speak(agentId, text)` → bytes of `resources/fake/voices/<agentId>.mp3` if present (read through an
     injectable reader so tests never touch disk), else an empty `ArrayBuffer` (= silence).
   - `resolveApproval` → resumes the waiting approval run (unknown callId: no-op).
   - `wakeAgent(id)` → presence active (`user`). `setDoNotDisturb(on)` → stored.
   - `getSettings`/`setSettings` → in-memory, deep-merging nested records (`models`, `installed`, `timers`,
     `nudges`); default settings as in Wave 0's stub; `demoMode` from options → demo timers 30/60/20.
   - `connectGoogle` → `{ email: 'demo.user@gmail.com' }` and stores it in settings; `learnEmailStyle` →
     `{ sampled: 25 }`.
   - `getTimeline(from, to)` → events from `bus.recent()` in range; `getTaskEvents(taskId)` → that task's
     events from `bus.recent()` (so Replay works on anything played this session).
   - Memories: canned 3–5 per core animal, in memory; `searchMemories` (substring, case-insensitive),
     `updateMemory`, `deleteMemory` mutate the in-memory list.
   - `getPulse()` → **exactly** this shape (Lane L5 renders it):
     `{ moodWeek: { day: 'Mon'|'Tue'|'Wed'|'Thu'|'Fri'|'Sat'|'Sun'; mood: UserMood; score: number }[];
        jobsPerAgent: Partial<Record<AgentId, number>>; wardenBlocks: number; wardenAsks: number }`
   - `getWardenAudit(limit)` → newest-first rows, **exactly**:
     `{ ts: number; taskId?: string; agentId: AgentId; tool: string; verdict: 'allow'|'ask'|'deny';
        rule: string; reason: string }` — canned rows plus a row for every `wolf.verdict` seen this session
     (with its `taskId`, so the Hub's Replay button works).
   Export the two shapes as types `FakePulse` / `FakeAuditRow` from `src/main/fake/types.ts`.
4. **`registerCoreIpc.ts`**: keep Wave 0's behavior; add light argument validation (`sendMessage` text is a
   string ≤ 4000 chars; `sendVoice` audio is an `ArrayBuffer` ≤ 10 MB; ids are strings) — reject with an
   Error, never crash main.
5. `resources/fake/voices/README.txt` (one line: "Optional <agentId>.mp3 sample clips; missing = silence").

## Tests you must add
EventPlayer with a fake clock (order, stable ties, speed 2, setSpeed mid-play, pause/resume, stop, onDone);
every script: steps sorted, valid ids, each `agent.handoff` has matching `job.update`s, one `taskId` per run;
keyword routing + fallback; approval allow and deny branches; `angry-relief` contagion timing (400/250 ms)
and the 20 s calm-down; `getTaskEvents` after a run; memory CRUD; settings deep-merge; `getPulse` /
`getWardenAudit` shapes; registerCoreIpc validation.

## Lane-specific STOP conditions
- A script needs an event or field that `BiomeEvent` doesn't have.
