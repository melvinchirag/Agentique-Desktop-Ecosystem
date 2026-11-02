# ADE Architecture

> **v0.2 update (Nov 2, 2026):** this document was written for the Hack Dearborn build (Oct 4). Since v0.2, memories, Timeline, Audit, Pulse, Replay and chat history are stored locally in `%APPDATA%\ADE\ade.db` (no Backboard memory, no Tiger; Tiger is optional and off by default). Backboard still runs the AI (Gemini 2.5 Flash by default) and Archie's document reading. What the code does now: [`docs/RELEASE-0.2.0.md`](RELEASE-0.2.0.md).

Read `README.md` first for scope and ownership. Agent-by-agent specs are in `AGENTS.md`.

---

## 1. System overview

```
┌──────────────────────────── Electron app (ADE.exe) ────────────────────────────┐
│                                                                                │
│  RENDERER (React + R3F)                    MAIN PROCESS (Node, TypeScript)     │
│  ┌──────────────────────────┐   IPC     ┌──────────────────────────────────┐   │
│  │ DesktopOverlay (3D)     │◀─events───│ EventBus ──┬─▶ IPC to renderer    │   │
│  │  ├ Character × 8         │           │            ├─▶ TigerStore (log)   │   │
│  │  └ AnimationDirector     │           │            └─▶ MoodEngine         │   │
│  │ Overlay UI               │──cmds────▶│                                   │   │
│  │  ├ Chat / transcript     │           │ Orchestrator (Chip)               │   │
│  │  ├ Push-to-talk          │           │   └ delegate ─▶ AgentRuntime      │   │
│  │  ├ ApprovalCard (Wolf)   │           │                  ├ Backboard client│  │
│  │  ├ Drafts tray           │           │                  └ tool calls ─▶ WolfGate ─▶ Tool executors
│  │  ├ Timeline / Replay     │           │ Connectors: Google · FS · Shell   │   │
│  │  └ Settings / Onboarding │           │ Voice: ElevenLabs TTS / STT       │   │
│  └──────────────────────────┘           └──────────────────────────────────┘   │
└────────────────────────────────────────────────────────────────────────────────┘
        External: Backboard API · ElevenLabs API · Tiger Cloud (Postgres) · Google Workspace APIs
```

**The one rule that makes the project work:** every visible thing in the biome is caused by a `BiomeEvent`.
Agents never talk to the renderer directly; they emit events. The renderer never fakes activity.

---

## 2. Repo layout

Monorepo, single Electron app. Scaffold with `npm create @quick-start/electron@latest ade -- --template react-ts`.

```
ade/
├─ docs/                      ← copy of this ade-plan folder
├─ src/renderer/public/characters, biomes ← drag-and-drop 3D assets (see ASSETS.md)
├─ resources/sfx/*.mp3        ← ElevenLabs sound effects
├─ scripts/
│   ├─ design-voices.ts       ← one-off: create ElevenLabs voices → writes voice IDs to config
│   ├─ create-assistants.ts   ← one-off: create the 8 Backboard assistants → writes IDs to config
│   └─ tiger-schema.sql       ← run once against Tiger Cloud
├─ src/
│   ├─ shared/                ← LOCKED CONTRACTS (Chanuth only edits)
│   │   ├─ agents.ts
│   │   ├─ events.ts
│   │   ├─ tools.ts
│   │   ├─ ipc.ts
│   │   └─ config.ts
│   ├─ main/
│   │   ├─ index.ts           ← app boot, window, wiring       (Chanuth)
│   │   ├─ bus/               ← EventBus                       (Chanuth)
│   │   ├─ runtime/           ← orchestrator, jobs, presence, mood, nudges, history (Melvin) · backboard.ts (Shafeen)
│   │   ├─ wolf/              ← policy.ts, injection.ts, approvals.ts (Melvin)
│   │   ├─ agents/
│   │   │   ├─ chipmunk/      (Chanuth)   ├─ workspace/  (Melvin)
│   │   │   ├─ wolf/          (Melvin)    ├─ beaver/     (owner TBD)
│   │   │   ├─ eagle/         (owner TBD) ├─ butterfly/  (extra)
│   │   │   ├─ ants/          (owner TBD) └─ nightingale/(extra)
│   │   │   (each: index.ts = AgentDefinition, prompt.md, tools.ts)
│   │   ├─ connectors/google/ (Melvin)   connectors/fs/ (owner TBD)
│   │   ├─ voice/             (Shafeen: ElevenLabs TTS/STT/cache)
│   │   └─ store/             (Shafeen: Tiger sink, history, nudges, queries)
│   ├─ preload/index.ts       ← exposes window.ade API (Chanuth)
│   └─ renderer/              (Shafeen)
│       ├─ scene/ DesktopOverlay.tsx, Character.tsx, AnimationDirector.ts, layout.ts
│       └─ ui/ Chat.tsx, PushToTalk.tsx, ApprovalCard.tsx, DraftsTray.tsx,
│              Timeline.tsx, MemoryScreen.tsx, Settings.tsx, Onboarding.tsx, Marketplace.tsx
├─ .env.example
└─ electron-builder.yml       ← NSIS target, appId com.ade.forest, productName ADE
```

**Ownership rule:** you only edit your own folders. Need a contract change? Ask Chanuth; never edit `src/shared` yourself.

---

## 3. Shared contracts (LOCKED — paste verbatim into `src/shared/`)

### 3.1 `agents.ts`

```ts
export type AgentId =
  | 'chipmunk' | 'workspace' | 'wolf' | 'beaver' | 'eagle' | 'ants'   // core six
  | 'butterfly' | 'nightingale';                                       // extras (start asleep)

export type AgentStatus =
  | 'idle' | 'listening' | 'thinking' | 'working' | 'away'      // away = off-screen on a job (e.g. Scout flying)
  | 'speaking' | 'waiting_approval' | 'done' | 'error';

/** Where the animal is. Separate from status (what it's doing). */
export type Presence = 'active' | 'sleeping' | 'docked' | 'not_installed';

/** How an animal feels. Drives color tint, animation style, and voice settings. */
export type AgentMood =
  | 'neutral' | 'happy' | 'excited' | 'proud'
  | 'nervous' | 'scared' | 'sad' | 'protective' | 'sleepy' | 'relieved';

/** How Chip reads the user. */
export type UserMood = 'calm' | 'happy' | 'excited' | 'stressed' | 'angry' | 'sad';

export interface ModelChoice {
  llm_provider: string;   // Backboard provider id, e.g. 'openai' | 'anthropic' | 'google'
  model_name: string;     // e.g. 'gpt-4o', 'claude-sonnet-4-20250514'
}

export interface AgentProfile {
  id: AgentId;
  displayName: string;    // 'Chip', ... (names TBD)
  animal: string;
  role: string;           // one line, shown on hover
  tier: 'core' | 'extra';
  color: string;          // base accent color (hex)
}
```

### 3.2 `events.ts`

```ts
import type { AgentId, AgentStatus, AgentMood, UserMood, Presence } from './agents';
import type { Risk } from './tools';

interface Base {
  id: string;            // uuid v4
  ts: number;            // Date.now()
  sessionId: string;     // one per app launch
  taskId?: string;       // one per user request; shared by every event it causes
  agentId: AgentId;      // who emitted it
}

export type BiomeEvent = Base & (
  | { type: 'user.message';     text: string; source: 'text' | 'voice' }
  | { type: 'user.mood';        mood: UserMood; intensity: number; reason: string }          // 0..1
  | { type: 'agent.status';     status: AgentStatus; detail?: string }                       // detail = bubble text, e.g. "Reading 12 emails…"
  | { type: 'agent.mood';       mood: AgentMood; intensity: number; cause: AgentId | 'user' }
  | { type: 'agent.handoff';    to: AgentId; task: string; via?: AgentId }                   // Chip → specialist; via = whose result is being relayed
  | { type: 'agent.return';     to: AgentId; ok: boolean; summary: string }                  // specialist → Chip
  | { type: 'agent.say';        text: string; bubble: string; priority: 'warden' | 'chip' | 'report' | 'ack' }  // text spoken; bubble = 1–2 words; renderer plays by priority
  | { type: 'agent.presence';   presence: Presence; reason: 'idle_timeout' | 'dock_timeout' | 'user' | 'job' | 'startup' }
  | { type: 'job.update';       jobId: string; to: AgentId; state: 'queued' | 'running' | 'done' | 'failed' | 'cancelled'; title: string; position?: number; requestedBy: AgentId }
  | { type: 'agent.recall';     memories: string[] }                                         // Backboard retrieved_memories → 💭 sparkle
  | { type: 'nudge.fire';       nudgeId: string; kind: 'before' | 'after' | 'daily' | 'evening' | 'weekly' | 'custom'; about: string }
  | { type: 'tool.request';     callId: string; tool: string; args: unknown; risk: Risk }
  | { type: 'wolf.verdict';     callId: string; verdict: 'allow' | 'ask' | 'deny'; rule: string; reason: string }
  | { type: 'wolf.alert';       source: string; reason: string }                              // prompt-injection etc.
  | { type: 'approval.request'; callId: string; title: string; preview: string }
  | { type: 'approval.resolve'; callId: string; approved: boolean }
  | { type: 'tool.result';      callId: string; ok: boolean; summary: string }
  | { type: 'artifact';         kind: ArtifactKind; title: string; data: unknown; openUrl?: string }
);

export type ArtifactKind = 'email_draft' | 'email_digest' | 'calendar_event' | 'file_plan' | 'research_brief' | 'social_post' | 'day_plan';

export type BiomeEventType = BiomeEvent['type'];
```

**Privacy rule for events:** never put full email bodies, file contents, or tokens in an event. Use subjects, senders, counts, and summaries. Events are stored in Tiger Cloud.

### 3.3 `tools.ts`

```ts
import type { AgentId } from './agents';
import type { BiomeEvent } from './events';

/** Wolf uses this to decide what needs approval. */
export type Risk =
  | 'read'         // look only
  | 'draft'        // creates something the user must still act on (Gmail draft, post text)
  | 'write'        // changes the user's stuff (move file, create calendar event)
  | 'destructive'  // removes things (trash a file)
  | 'external';    // sends/posts/pays on the user's behalf. NO TOOL MAY HAVE THIS. Wolf denies it.

export interface ToolContext {
  agentId: AgentId;
  taskId: string;
  jobId: string;
  sessionId: string;
  emit: (e: DistributiveOmit<BiomeEvent, 'id' | 'ts' | 'sessionId'>) => void;
  signal: AbortSignal;
}

export interface ToolDefinition<I = any, O = any> {
  name: string;                       // snake_case, unique across all agents, prefixed: gmail_, cal_, fs_, web_, social_, music_, plan_
  description: string;                // written for the LLM
  parameters: Record<string, unknown>;// JSON Schema (OpenAI function format) — sent to Backboard as-is
  risk: Risk;
  /** Optional dynamic risk escalation, e.g. bulk file moves, events with attendees. */
  riskFor?: (input: I) => Risk;
  /** Human-readable preview for Wolf's approval card. Required when risk can be write/destructive. */
  preview?: (input: I) => string;
  execute: (input: I, ctx: ToolContext) => Promise<O>;
}

export interface AgentDefinition {
  id: AgentId;
  systemPrompt: string;               // loaded from prompt.md
  tools: ToolDefinition[];
  maxToolRounds: number;              // default 8
  webSearch?: boolean;                // Backboard web_search: 'Auto' (Scout)
}

export type DistributiveOmit<T, K extends keyof any> = T extends any ? Omit<T, K> : never;
```

### 3.4 `ipc.ts`

```ts
import type { BiomeEvent } from './events';
import type { AgentId, AgentMood, ModelChoice } from './agents';

/** Exposed on window.ade by preload. Renderer → main. */
export interface AdeApi {
  sendMessage(text: string, source: 'text' | 'voice'): Promise<void>;
  sendVoice(audio: ArrayBuffer, mime: string): Promise<void>;                    // main: ElevenLabs STT (with audio-event cues) → orchestrator
  speak(agentId: AgentId, text: string, mood: AgentMood): Promise<ArrayBuffer>;  // ElevenLabs TTS (mp3)
  resolveApproval(callId: string, approved: boolean): Promise<void>;
  wakeAgent(agentId: AgentId): Promise<void>;                                     // Agent Hub dropdown
  setDoNotDisturb(on: boolean): Promise<void>;
  demoFireNudge(): Promise<void>;                                                 // demo hotkey Ctrl+Shift+N
  getSettings(): Promise<AdeSettings>;
  setSettings(patch: Partial<AdeSettings>): Promise<void>;
  connectGoogle(): Promise<{ email: string }>;
  learnEmailStyle(): Promise<{ sampled: number }>;
  getTimeline(fromTs: number, toTs: number): Promise<BiomeEvent[]>;             // Tiger
  getTaskEvents(taskId: string): Promise<BiomeEvent[]>;                         // Tiger, for Replay
  getMemories(agentId: AgentId): Promise<{ id: string; memory: string }[]>;      // Backboard
  searchMemories(agentId: AgentId, q: string): Promise<{ id: string; memory: string }[]>;
  updateMemory(agentId: AgentId, memoryId: string, text: string): Promise<void>;
  deleteMemory(agentId: AgentId, memoryId: string): Promise<void>;
  getPulse(): Promise<object>;                                                    // Tiger: mood_daily + job_stats_daily + activity
  getWardenAudit(limit: number): Promise<object[]>;                              // Tiger: wolf_audit
  onEvent(cb: (e: BiomeEvent) => void): () => void;                             // main → renderer stream
}

export interface AdeSettings {
  models: Record<AgentId, ModelChoice>;
  voiceEnabled: boolean;
  allowedFolders: string[];      // Beaver's sandbox
  googleEmail?: string;
  biome: 'forest';               // 'desert' | 'snow' later
  demoMode: boolean;             // replay a recorded session if the network dies; short timers
  installed: Record<AgentId, boolean>;
  timers: { sleepAfterSec: number; dockAfterSec: number; moodDecaySec: number };   // default 180 / 600 / 20; demo 30 / 60 / 20
  nudges: { enabled: boolean; quietStart: string; quietEnd: string; maxPerHour: number };  // '23:00', '08:00', 3
}

export const IPC = {
  sendMessage: 'ade:send-message', sendVoice: 'ade:send-voice', speak: 'ade:speak',
  resolveApproval: 'ade:approval', getSettings: 'ade:settings:get', setSettings: 'ade:settings:set',
  wakeAgent: 'ade:hub:wake', setDoNotDisturb: 'ade:hub:dnd', demoFireNudge: 'ade:demo:nudge',
  connectGoogle: 'ade:google:connect', learnEmailStyle: 'ade:google:learn-style',
  getTimeline: 'ade:tiger:timeline', getTaskEvents: 'ade:tiger:task', getMemories: 'ade:bb:memories',
  deleteMemory: 'ade:bb:memory-delete', searchMemories: 'ade:bb:memory-search', updateMemory: 'ade:bb:memory-update',
  getPulse: 'ade:tiger:pulse', getWardenAudit: 'ade:tiger:audit', event: 'ade:event',
} as const;
```

### 3.5 `config.ts`

```ts
import type { AgentId, AgentProfile } from './agents';

export const AGENTS: Record<AgentId, AgentProfile> = {
  chipmunk:    { id: 'chipmunk',    displayName: 'Chip',  animal: 'chipmunk',    role: 'Your guide. Listens, reads the room, sends the right animal.', tier: 'core',  color: '#C8814A' },
  workspace:   { id: 'workspace',   displayName: 'Pixel',   animal: 'custom',      role: 'Google Workspace. Writes like you. Never sends.',            tier: 'core',  color: '#7A6A9E' },
  wolf:        { id: 'wolf',        displayName: 'Warden',   animal: 'wolf',        role: 'Guardian. Checks every action. Keeps the audit log.',        tier: 'core',  color: '#5B6770' },
  beaver:      { id: 'beaver',      displayName: 'Archie',   animal: 'beaver',      role: 'Files. Finds, sorts, and tidies. Every move can be undone.',  tier: 'core',  color: '#8B5A2B' },
  eagle:       { id: 'eagle',       displayName: 'Scout',   animal: 'eagle',       role: 'Web research and browsing, with sources.',                    tier: 'core',  color: '#D4A017' },
  ants:        { id: 'ants',        displayName: 'Swarm',   animal: 'ants',        role: 'Plans your day and breaks big goals into steps.',             tier: 'core',  color: '#A23B2A' },
  butterfly:   { id: 'butterfly',   displayName: 'Iris',   animal: 'butterfly',   role: 'Social posts in your voice. Never posts.',                    tier: 'extra', color: '#E26D9C' },
  nightingale: { id: 'nightingale', displayName: 'Celene',   animal: 'nightingale', role: 'Music that matches your mood.',                               tier: 'extra', color: '#4E8F7A' },
};
```

Display names live only in this file. Code always uses the `AgentId`.

---

## 4. Main-process runtime

### 4.1 EventBus (`main/bus`)
- `emit(partialEvent)` fills `id`, `ts`, `sessionId` and fans out synchronously to subscribers.
- Subscribers wired in `main/index.ts`: (1) IPC `ade:event` → renderer, (2) `TigerStore.enqueue`, (3) `MoodEngine.onEvent`.
- Keep an in-memory ring buffer of the last 500 events (used by demo mode and as a Tiger fallback).

### 4.2 Backboard client (`main/runtime/backboard.ts`)
Base URL `https://app.backboard.io/api`, header `X-API-Key: $BACKBOARD_API_KEY`.

| Function | Call |
|---|---|
| `createAssistant(name, systemPrompt, tools)` | `POST /assistants` `{ name, system_prompt, tools }` → `assistant_id` |
| `send({assistantId, threadId?, content, tools, model, memory, webSearch, jsonOutput})` | `POST /threads/messages` `{ assistant_id, thread_id, content, tools, llm_provider, model_name, memory: 'Auto', web_search: 'Auto'\|'off', json_output }` |
| `submitToolOutputs(threadId, outputs)` | `POST /threads/tool-outputs` `{ thread_id, tool_outputs: [{ tool_call_id, output }] }`. **Must include an output for every tool call.** |
| `listMemories(assistantId)` / `addMemory(assistantId, text)` / `deleteMemory` | memories endpoints |
| `listModels()` | `GET` models list → populates the Settings dropdown |

Response: `status` ∈ `COMPLETED | REQUIRES_ACTION | FAILED | …`; when `REQUIRES_ACTION`, read `tool_calls[]` (`id`, `function.name`, `function.arguments` as a JSON string).

> **Spike first (Chanuth, 20 min):** confirm the tool-outputs path and the response it returns, the exact model names from the models endpoint, and whether users can bring their own provider keys. Docs: https://backboard-docs.docsalot.dev/llms.txt

Threads: **Chip** keeps one conversation thread per app session. **Every job gets a fresh thread** (long-term memory still carries over because it belongs to the assistant). Assistant IDs come from `scripts/create-assistants.ts` and go in `.env` / config.

### 4.3 AgentRuntime (`main/runtime/agentRuntime.ts`)
**v3.1 additions (see `agents/01-chip-orchestrator.md`):** returns `AgentResult { ok, say, bubble, summary, artifacts }` parsed from the specialist output format (Chip spec §16); injects `ask_teammate` into normal jobs only (§10.6); calls `jobs.pauseClock/resumeClock` around Warden approvals; one fresh Backboard thread per job.

```
runAgent(agentId, task, taskId) → { ok, summary, artifacts[] }
  emit agent.status(working, "…")
  resp = backboard.send({ assistant: agentId, content: task, tools: def.tools.map(toOpenAiFormat),
                          model: settings.models[agentId], memory: 'Auto' })
  rounds = 0
  while resp.status === 'REQUIRES_ACTION' && rounds++ < def.maxToolRounds:
      outputs = await Promise.all(resp.tool_calls.map(call => executeGuarded(agentId, call, taskId)))
      resp = backboard.submitToolOutputs(threadId, outputs)
  emit agent.status(done) ; return { ok: resp.status === 'COMPLETED', summary: resp.content }

executeGuarded(agentId, call, taskId):
  tool = registry[call.function.name]; args = JSON.parse(call.function.arguments)
  risk = tool.riskFor?.(args) ?? tool.risk
  emit tool.request
  verdict = WolfGate.review(agentId, tool, args, risk)        // emits wolf.verdict
  if verdict === 'deny'  → return { tool_call_id, output: JSON.stringify({ error: 'DENIED_BY_WOLF', reason }) }
  if verdict === 'ask'   → emit approval.request; approved = await Approvals.wait(callId)   // 5-min timeout = deny
                           if !approved → return { …, output: '{"error":"USER_DECLINED"}' }
  result = await tool.execute(args, ctx)          // catch → { error: message }
  emit tool.result(ok, summary)
  return { tool_call_id: call.id, output: JSON.stringify(result) }   // truncate to 12k chars
```

Untrusted content (email bodies, web pages, file text) that goes back to the LLM is wrapped as
`<untrusted source="gmail:…">…</untrusted>` after passing `wolf/injection.ts` (see AGENTS.md → Wolf).

### 4.4 Orchestrator (`main/runtime/orchestrator.ts`) — Chip
**Full spec: `agents/01-chip-orchestrator.md` (v3.1).** Chip is event-driven: an inbox of user messages, job results, and nudges; non-blocking `delegate`; parallel jobs through the JobScheduler; presence (sleep/dock); push-first nudges.

### 4.5 MoodEngine (`main/runtime/mood.ts`) — the biome reacts
**Full spec: `agents/01-chip-orchestrator.md §15`** (reaction table, contagion order, decay, relief).

### 4.6 WolfGate — see AGENTS.md → Wolf for the full rule table.

---

## 5. Renderer

### 5.1 Scene (`renderer/scene`)
- **Real Windows desktop overlay (decided):** one transparent, frameless, always-on-top Electron window over the screen; a transparent R3F `<Canvas>`; clicks pass through to the apps underneath except over an animal, a bubble, or the Agent Hub. **No app window, no biome scene** (biome visuals deferred). Each animal has a **spot on the desktop** (`layout.ts`, e.g. along the bottom of the work area above the taskbar). Handoffs happen where the animals are: Chip runs to the target animal. Exact overlay mechanics (click-through toggling, focus, multi-monitor, performance) → the app shell plan.
- Camera: slightly elevated 3/4 view with gentle orbit; it frames the active agent during a task.
- Lighting: warm daylight. The overall color temperature follows the forest's average mood.

### 5.2 Character component
`<Character id={agentId} />` loads `characters/{agentId}/{skin}/model.glb` with `useGLTF` (full asset contract: ASSETS.md).
- If the GLB has animation clips named `Idle`, `Walk`, `Talk`, `Work`, `Happy`, `Scared`, play them with `useAnimations`.
- Otherwise use **procedural animation** (§8): hop, bob, squash-and-stretch, spin, tremble.
- **Mood tint:** lerp an emissive overlay per mood: scared `#4A90E2` (blue), nervous `#8FB3D9`, happy `#FFD36E`, excited `#FF9EC7` + sparkles, proud `#FFC34D`, sad desaturate 60%, protective `#B0413E` rim light, sleepy dim + floating "z".
- **Status bubble:** drei `<Html>` above the head shows `agent.status.detail` or the current `agent.say` text.

### 5.3 AnimationDirector (`renderer/scene/AnimationDirector.ts`)
Subscribes to `window.ade.onEvent`. Keeps a per-agent state machine plus an **action queue** so animations never overlap badly.

| Event | Animation |
|---|---|
| `user.message` | Chip perks up, ears up, `listening` pose |
| `agent.handoff` | Chip runs to the target animal and hands over a glowing "task scroll"; the target starts `Work`. **`via: 'ants'`** → instead, one ant walks from Swarm's colony to the target carrying the scroll. **Help jobs** → the asking animal walks to the helper. |
| `agent.status: working` | Work loop + bubble text. Workspace char sorts letters, Beaver carries logs, Eagle circles overhead, Butterfly sketches. |
| `tool.request` (risk ≥ write) | Wolf's ears prick up; Wolf turns toward the agent |
| `wolf.verdict: ask` | Wolf walks to the agent and sits; ApprovalCard slides in |
| `wolf.verdict: deny` | Wolf jumps between the agent and the camera, growls (SFX), red rim flash |
| `wolf.alert` | Wolf howls; a warning bubble shows |
| `agent.return` | Agent carries the scroll back to Chip at the stump; Chip happy-hops |
| `agent.say` | Talk animation + bubble + TTS playback (one speaker at a time, queued) |
| `agent.mood` | Tint + mood clip/procedural style (§5.2) |
| `artifact` | An item drops into the Drafts tray with a pop sound |
| `agent.presence` | sleeping → `Yawn` → `Sleep`; docked → `SleepWalk` to the Hub + shrink; active from docked → returns from the Hub |
| `job.update` | Updates the Agent Hub status rows; `away` status (Scout) → `Takeoff` → fly out of frame |
| `nudge.fire` | Chip `WakeUp` (if asleep) → `Nudge` (knocks on the screen) |

**Replay mode:** the same director accepts a list of stored events and re-plays them with their original relative timing (×2 speed). That is Biome Replay.

### 5.4 Overlay UI (`renderer/ui`)
- **Chat:** lives in the Agent Hub (transcript + text box). **Voice: click-and-hold on Chip (or the Hub's mic button)**, no global hotkeys.
- **Clicking another animal** → its inspect card (status, current job, queue, wake/sleep, memories). ✅
- **ApprovalCard:** Wolf avatar, `title`, `preview`, **Allow** / **Deny** buttons.
- **DraftsTray:** artifacts (email drafts → "Open in Gmail", file plans, research briefs, social posts → "Copy").
- **Timeline:** bottom strip from Tiger; click a task → Biome Replay. Wolf Audit tab lists every verdict.
- **MemoryScreen:** per animal, "what I remember about you" (Backboard memories), with delete.
- **Settings:** model per agent (from Backboard's model list), voice on/off, allowed folders, Google connect.
- **Onboarding (first run, 3 steps):** 1) pick your AI, 2) connect Google, 3) "<Workspace char> is learning how you write…" (animated).
- **Agent Hub (draggable box, top-right):** a status row per animal (job title + timer, queued position, asleep/docked); an **Agents ▾** dropdown to wake docked animals; a do-not-disturb toggle; tabs **Memories** (Backboard: list/search/edit/delete per animal), **Pulse** (Tiger: mood this week, jobs per animal, Warden blocks), **Audit** (Tiger: `wolf_audit`). **Click the box → Marketplace.**
- **Marketplace (designed later; static for the demo):** all animals (install/wake), community-shared agents, skins, biomes (forest ✓, desert, snow), "Verified by Warden" badge.
- **Recall sparkle:** on `agent.recall`, a 💭 sparkle above the animal + "Remembered: …" line in the transcript.

---

## 6. Tiger Data (`main/store/tiger.ts`, `scripts/tiger-schema.sql`) — Shafeen
**Full schema incl. new tables/aggregates/policies: `SPONSORS.md` Part 4.**

Tiger Cloud service (Postgres + TimescaleDB). Connect with `pg` using `TIGER_DATABASE_URL`.

```sql
CREATE TABLE IF NOT EXISTS biome_events (
  ts          TIMESTAMPTZ NOT NULL,
  id          UUID        NOT NULL,
  session_id  UUID        NOT NULL,
  task_id     UUID,
  agent_id    TEXT        NOT NULL,
  type        TEXT        NOT NULL,
  payload     JSONB       NOT NULL
);
SELECT create_hypertable('biome_events', by_range('ts'), if_not_exists => TRUE);
CREATE INDEX IF NOT EXISTS ix_events_task ON biome_events (task_id, ts);
CREATE INDEX IF NOT EXISTS ix_events_type ON biome_events (type, ts DESC);

-- Wolf's audit trail
CREATE OR REPLACE VIEW wolf_audit AS
SELECT ts, task_id, agent_id, type,
       payload->>'callId' AS call_id, payload->>'verdict' AS verdict,
       payload->>'rule' AS rule, payload->>'reason' AS reason, payload->>'approved' AS approved
FROM biome_events
WHERE type IN ('wolf.verdict', 'wolf.alert', 'approval.resolve');

-- Activity per animal, 5-minute buckets (the "forest pulse" chart)
CREATE MATERIALIZED VIEW IF NOT EXISTS agent_activity_5m
WITH (timescaledb.continuous) AS
SELECT time_bucket('5 minutes', ts) AS bucket, agent_id,
       count(*) AS events,
       count(*) FILTER (WHERE type = 'tool.result') AS actions
FROM biome_events GROUP BY bucket, agent_id;
SELECT add_continuous_aggregate_policy('agent_activity_5m',
  start_offset => INTERVAL '1 day', end_offset => INTERVAL '1 minute', schedule_interval => INTERVAL '1 minute');

-- Jobs (Agent Hub status history)
CREATE OR REPLACE VIEW job_history AS
SELECT ts, payload->>'jobId' AS job_id, payload->>'to' AS agent, payload->>'state' AS state,
       payload->>'title' AS title, payload->>'requestedBy' AS requested_by
FROM biome_events WHERE type = 'job.update';

-- Push-first nudges (Chip's follow-ups)
CREATE TABLE IF NOT EXISTS nudges (
  id UUID PRIMARY KEY, kind TEXT NOT NULL, about TEXT NOT NULL, question TEXT NOT NULL,
  ask_at TIMESTAMPTZ NOT NULL, state TEXT NOT NULL DEFAULT 'pending',   -- pending | fired | answered | snoozed | cancelled
  source TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_nudges_due ON nudges (state, ask_at);

-- Mood over time
CREATE OR REPLACE VIEW user_mood_timeline AS
SELECT ts, payload->>'mood' AS mood, (payload->>'intensity')::float AS intensity
FROM biome_events WHERE type = 'user.mood';
```

Writer: batch insert every 500 ms. On failure, append to `%APPDATA%/ADE/pending-events.jsonl` and flush later. **The app must keep working if Tiger is unreachable.**

Queries behind the IPC: `getTimeline` (range), `getTaskEvents` (Replay), `wolfAudit(limit)`, `activity(since)`, `moodTimeline(since)`.

---

## 7. ElevenLabs (`main/voice/elevenlabs.ts`) — Shafeen
**Full plan (v4 turbo + mood tags, scribe_v2, Voice Design, SFX, music): `SPONSORS.md` Part 3. It wins over this section.**

Use the official JS SDK (`@elevenlabs/elevenlabs-js`) or plain REST with the `xi-api-key` header.

| Feature | How |
|---|---|
| **Voices** | `scripts/design-voices.ts` creates one voice per animal using Voice Design (text → voice), then saves the voice IDs. Descriptions are in AGENTS.md. Fallback: pick premade voices from the voice library. |
| **TTS** | Text-to-speech using a low-latency model (Flash/Turbo family; check the current model ID in the docs). Return mp3 bytes to the renderer, which plays them through an audio queue. Cache by `(agentId, text)` for repeated lines like greetings. |
| **Mood → voice** | `voice_settings` per mood: excited/scared → stability 0.3, style 0.6; sad → stability 0.6, slower speed; protective → stability 0.8. |
| **STT** | Renderer records with `MediaRecorder` (webm/opus) while the user holds Chip (or the Hub mic) → `window.ade.sendVoice(audio, mime)` → main calls ElevenLabs Speech-to-Text (`scribe_v1` or newer, `tag_audio_events: true`) → audio events like `(sighs)` become `voiceCues` → orchestrator. |
| **SFX** | Generate once with the Sound Effects API: chipmunk chirp, wolf growl, wolf howl, workspace-char sound, beaver tail slap, eagle screech, wing flutter, scroll pass, pop. Save to `resources/sfx`. |

Only one agent talks at a time. The renderer owns the playback queue and plays by `agent.say.priority`: warden > chip > report > ack. `report`/`ack` lines waiting > 8 s are dropped (bubble still shows).

---

## 8. 3D characters and biomes

Every animal is rigged in Blender (Zarin). The full drag-and-drop contract (folders, export settings, exact clip names, shape keys, biome markers, Asset Lab) is in **`ASSETS.md`**. Code must always fall back to procedural animation when a model or clip is missing.

---

## 9. Google connector (`main/connectors/google`) — Melvin

- Google Cloud project → enable the **Gmail API** and **Google Calendar API** → OAuth consent screen in **Testing** mode → add all 4 team accounts and the demo account as test users → OAuth client type **Desktop app**.
- Flow: `google-auth-library` `OAuth2Client` with a loopback redirect (`http://127.0.0.1:<random port>`), opened via `shell.openExternal`. Store refresh tokens with Electron `safeStorage`.
- Scopes: `gmail.readonly`, `gmail.compose` (create and update drafts), `calendar.events`.
  `gmail.compose` technically allows sending. ADE simply has no send tool, and Wolf denies the `external` category. Say exactly this if a judge asks.
- Calendar inserts must use `sendUpdates: 'none'` so no invite emails go out without the user.

---

## 10. Environment

```
BACKBOARD_API_KEY=
BB_ASSISTANT_CHIPMUNK=   BB_ASSISTANT_WORKSPACE=   BB_ASSISTANT_WOLF=   BB_ASSISTANT_BEAVER=
BB_ASSISTANT_EAGLE=      BB_ASSISTANT_BUTTERFLY=   BB_ASSISTANT_ANTS=   BB_ASSISTANT_NIGHTINGALE=
ELEVENLABS_API_KEY=
EL_VOICE_CHIPMUNK=  EL_VOICE_WORKSPACE=  EL_VOICE_WOLF=  EL_VOICE_BEAVER=  EL_VOICE_EAGLE=  EL_VOICE_ANTS=
EL_VOICE_BUTTERFLY=  EL_VOICE_NIGHTINGALE=
TIGER_DATABASE_URL=postgres://...
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
```

Never commit `.env`. Share keys through a private channel, not the repo.

---

## 11. Build & package

- `npm run dev` (electron-vite). `npm run build:win` → `electron-builder --win nsis` → `dist/ADE-Setup-x.y.z.exe`.
- Put GLBs and SFX in `resources/` (`extraResources`). Build the .exe by 9:30 AM and test it on a second laptop.
- An unsigned .exe triggers Windows SmartScreen ("More info → Run anyway"). That's fine for the demo; code signing goes on the roadmap.
