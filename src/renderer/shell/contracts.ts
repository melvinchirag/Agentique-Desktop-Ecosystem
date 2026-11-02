/**
 * Renderer-side app-shell contracts (spec 00-APP-SHELL-SPEC.md §3, §5–§10).
 *
 * FROZEN in Wave 0 (01-APP-SHELL-BUILD-LANES.md §3). Lanes never edit this file. A lane that needs a
 * change STOPs and asks the orchestrator; every lane then rebases.
 *
 * Wave 1 lanes code only against these interfaces and mock the others (lanes table §4 "Lane independence").
 * Coordinates are overlay-local CSS px (= DIP), see Rect in src/main/shell/contracts.ts.
 */
import type { ComponentType } from 'react';
import type { StoreApi, UseBoundStore } from 'zustand';
import type { AgentId, AgentMood, AgentStatus, Presence, UserMood } from '../../shared/agents';
import type { ArtifactKind, BiomeEvent } from '../../shared/events';
import type { AdeApi, AdeSettings } from '../../shared/ipc';
import type { Clock } from '../../main/runtime/types';
import type { AdeShellApi, DisplayLayout, EventPlayer, Point, Rect } from '../../main/shell/contracts';

// ── Hit testing (spec §3) — Lane L1: src/renderer/shell/hitRegistry.ts ──────────

export type HitKind = 'animal' | 'bubble' | 'card' | 'banner';
export interface HitShape { id: string; kind: HitKind; rect: Rect }

export interface HitRegistry {
  /** Add or replace a shape; call again whenever it moves (animals: every rendered frame). rect null → remove. */
  set(id: string, kind: HitKind, rect: Rect | null): void;
  remove(id: string): void;
  shapes(): readonly HitShape[];
  /** The shape containing the point, else null. bubble/card/banner beat animal; among equals, last set wins. */
  hitTest(p: Point): HitShape | null;
  /**
   * Feed every (forwarded) mousemove, overlay-local. Calls sink.setInteractive only on change;
   * going false is debounced (60 ms default) so moving between two shapes doesn't flicker.
   */
  pointerMove(p: Point): void;
  /** While a press/drag/hold is in progress the overlay stays interactive wherever the pointer is. */
  setCaptured(on: boolean): void;
  dispose(): void;
}
export interface HitRegistrySink {
  setInteractive(on: boolean): void;
  /** Throttled by the registry (publishHz, default 10). Only matters in 'poll' pointer mode. */
  publishHitShapes(rects: Rect[]): void;
}
export type CreateHitRegistry = (
  sink: HitRegistrySink,
  opts?: { leaveDebounceMs?: number; publishHz?: number; clock?: Clock },
) => HitRegistry;

// ── Desktop layout (spec §5) — Lane L4: src/renderer/overlay/layout.ts ───────────

export interface DesktopLayout {
  width: number;                    // overlay width (= work-area width)
  height: number;                   // overlay height (= work-area height)
  groundY: number;                  // height − 4: where animals' feet stand (taskbar's top edge)
  spots: Record<AgentId, number>;   // home x (center) per animal, spec §5 percentages
  colonyX: number;                  // Swarm's colony (= spots.ants)
  centerX: number;                  // screen center-bottom, used by nudges
  hubX: number;                     // Hub center x on the ground: sleep-walk target
  dockPoint: Point;                 // under the Hub's header, where docked animals shrink into
}
export type ComputeLayout = (display: DisplayLayout) => DesktopLayout;

// ── CharacterLayer (spec §6) — Lane L3: src/renderer/overlay/characters/** ───────

export type Gait = 'walk' | 'run' | 'fly' | 'sleepwalk';
export type Facing = 'left' | 'right' | 'front';

export interface CharacterLayer {
  /** Stands the animal on the ground at x (idempotent; an existing animal is moved there). */
  spawn(id: AgentId, x: number): void;
  despawn(id: AgentId): void;
  has(id: AgentId): boolean;
  /**
   * Plays a clip by exact name (ASSETS.md §3; Chip: animations/chip-actions.md) with a 0.25 s crossfade.
   * Missing clip → procedural fallback. once: resolves when it ends and returns to the current loop.
   * Loops resolve immediately and become the current loop.
   */
  play(id: AgentId, clip: string, opts?: { once?: boolean }): Promise<void>;
  /** Moves along the ground; resolves on arrival. A newer moveTo/flyOff/dockInto for the same id resolves the older one early. */
  moveTo(id: AgentId, x: number, opts?: { gait?: Gait }): Promise<void>;
  face(id: AgentId, facing: Facing): void;
  /** Takeoff → arc up and out through the top edge; hidden afterwards. */
  flyOff(id: AgentId): Promise<void>;
  /** Re-enters from the top edge and lands at x. */
  flyIn(id: AgentId, x: number): Promise<void>;
  /** Floats up and shrinks into the point (0.6 s); hidden afterwards. */
  dockInto(id: AgentId, dockPoint: Point): Promise<void>;
  /** Reappears at the last dock point, drops to the ground at x. */
  undock(id: AgentId, x: number): Promise<void>;
  /** Mood tint by code (spec §6): scared blue #4A90E2, sad desaturate, protective red rim, sleepy dim + "z", ... */
  setMood(id: AgentId, mood: AgentMood, intensity?: number): void;
  /** 0..1 → `MouthOpen` morph, or a procedural jaw/scale fallback. */
  setMouth(id: AgentId, open: number): void;
  /** The task scroll carried in handoffs. */
  setProp(id: AgentId, prop: 'scroll' | null): void;
  /** One ant walks the ground from fromX to toX carrying a scroll, then vanishes. */
  antCarrier(fromX: number, toX: number): Promise<void>;
  /** Projected bounding box (unpadded), overlay-local; null when hidden or absent. */
  screenRect(id: AgentId): Rect | null;
  /** Feet position, overlay-local; null when hidden or absent. */
  position(id: AgentId): Point | null;
  /** The whole layer (Hide animals). Hidden → 0 fps. */
  setVisible(visible: boolean): void;
  /** New geometry (DPI / work area): re-ground everyone. */
  setLayout(layout: DesktopLayout): void;
}

export interface CharacterCanvasProps {
  layout: DesktopLayout;
  /** The layer registers `animal:<id>` shapes (bounding box padded 8 px) every rendered frame. */
  hit: HitRegistry;
  /** Base URL of characters/<agentId>/<skin>/model.glb (+ character.json). Default './characters'. */
  assetBase?: string;
  onReady(layer: CharacterLayer): void;
}
/** src/renderer/overlay/characters/index.ts exports `CharacterCanvas` with this type. */
export type CharacterCanvasComponent = ComponentType<CharacterCanvasProps>;

// ── Audio (spec §8, §4) — Lane L7: src/renderer/audio/** ─────────────────────────

export type SpeechPriority = 'warden' | 'chip' | 'report' | 'ack';
export interface SpeechItem { agentId: AgentId; text: string; mood: AgentMood; priority: SpeechPriority }
export type SpeechOutcome = 'played' | 'dropped' | 'failed' | 'cleared' | 'muted';

export interface SpeechQueue {
  /**
   * One voice at a time. Priority warden > chip > report > ack (FIFO within a priority).
   * report/ack items still waiting after 8 s are dropped (warden/chip never are).
   * Swarm ('ants') plays as a chorus (×3, detune ±25 cents, offsets 15/30 ms).
   */
  enqueue(item: SpeechItem): void;
  /** Stops the current voice and drops everything waiting (outcome 'cleared'). */
  clear(): void;
  readonly current: SpeechItem | null;
  /** off → nothing plays; enqueued items end immediately with outcome 'muted'. */
  setVoiceEnabled(on: boolean): void;
  setVolume(v: number): void;   // 0..1
  onStart(cb: (item: SpeechItem) => void): () => void;
  onEnd(cb: (item: SpeechItem, outcome: SpeechOutcome) => void): () => void;
  dispose(): void;
}
export interface SpeechQueueDeps {
  speak: AdeApi['speak'];                              // window.ade.speak → mp3 bytes (may be empty = silence)
  setMouth(agentId: AgentId, open: number): void;      // CharacterLayer.setMouth, from AnalyserNode RMS (smoothed)
  /** Injectable for tests; default creates one shared AudioContext lazily. */
  audioContext?: () => AudioContext;
  clock?: Clock;
}
/** src/renderer/audio/speechQueue.ts exports `createSpeechQueue`. */
export type CreateSpeechQueue = (deps: SpeechQueueDeps) => SpeechQueue;

export interface SfxPlayer {
  /** Names from resources/sfx/manifest.json; unknown name or missing manifest → silent. */
  play(name: string): void;
  setVolume(v: number): void;
  setEnabled(on: boolean): void;
  setAmbienceEnabled(on: boolean): void;
  dispose(): void;
}
/** src/renderer/audio/sfx.ts exports `createSfxPlayer`. baseUrl: where manifest.json and the files live. */
export type CreateSfxPlayer = (opts?: { baseUrl?: string; audioContext?: () => AudioContext }) => SfxPlayer;

export interface MicRecorder {
  readonly recording: boolean;
  /** getUserMedia + MediaRecorder; auto-stops at maxMs (default 30 000). */
  start(): Promise<void>;
  /** null when nothing was recorded. */
  stop(): Promise<{ audio: ArrayBuffer; mime: string } | null>;
}
export type CreateMicRecorder = (opts?: { maxMs?: number }) => MicRecorder;

/** Click-and-hold Chip (or the Hub mic) to talk; a short click (< 250 ms) focuses the Hub chat instead (spec §4). */
export interface PushToTalk {
  pointerDown(): void;
  pointerUp(): void;
  /** The press turned into a drag: stop the mic and send nothing. */
  cancel?(): void;
  readonly recording: boolean;
}
/** src/renderer/audio/pushToTalk.ts exports `createPushToTalk`. */
export type CreatePushToTalk = (deps: {
  mic: MicRecorder;
  sendVoice: AdeApi['sendVoice'];
  focusChat(): void;
  shortClickMs?: number;
  clock?: Clock;
}) => PushToTalk;

// ── Agent Hub state (spec §9) — Wave 0: src/renderer/shell/hubStore.ts ──────────

export type JobState = 'queued' | 'running' | 'done' | 'failed' | 'cancelled';
export interface JobInfo { jobId: string; to: AgentId; title: string; state: JobState; requestedBy: AgentId; since: number }

export interface AgentRow {
  id: AgentId;
  presence: Presence;
  status: AgentStatus;
  detail?: string;                // agent.status.detail
  mood: AgentMood;
  job: JobInfo | null;            // this agent's running job, if any
  queued: number;                 // this agent's jobs in state 'queued'
  pendingApproval: boolean;
  lastBubble?: string;            // latest agent.say bubble
}
export interface TranscriptLine {
  id: string;                     // the event id
  ts: number;
  from: AgentId | 'user';
  text: string;
  kind: 'user' | 'say' | 'recall' | 'alert' | 'system';
}
export interface TrayItem { id: string; ts: number; agentId: AgentId; kind: ArtifactKind; title: string; data: unknown; openUrl?: string }
export interface PendingApproval { callId: string; agentId: AgentId; title: string; preview: string; ts: number }

export interface HubState {
  agents: Record<AgentId, AgentRow>;
  jobs: Record<string, JobInfo>;
  /** callId → the agent that made the tool.request (so approvals know whose they are). */
  calls: Record<string, AgentId>;
  userMood: { mood: UserMood; intensity: number } | null;
  transcript: TranscriptLine[];   // oldest first, capped at 200
  tray: TrayItem[];               // newest first, capped at 50
  approvals: PendingApproval[];   // oldest first
  settings: AdeSettings | null;
  dnd: boolean;
  animalsHidden: boolean;
  replaying: boolean;
  lastEventTs: number;
}
export interface HubActions {
  applyEvent(e: BiomeEvent): void;   // set(reduceHubEvent(state, e))
  setSettings(s: AdeSettings): void;
  setDnd(on: boolean): void;
  setAnimalsHidden(on: boolean): void;
  setReplaying(on: boolean): void;
  /** Back to initialHubState() + patch (tests, seeding). */
  reset(patch?: Partial<HubState>): void;
}
export type HubStore = HubState & HubActions;
export type HubStoreHook = UseBoundStore<StoreApi<HubStore>>;
/** Pure; never mutates `state`. */
export type ReduceHubEvent = (state: HubState, e: BiomeEvent) => HubState;

// ── Overlay UI (spec §7, §10) — Lane L6: src/renderer/overlay/ui/** ──────────────

export type BubbleKind = 'say' | 'status' | 'waiting' | 'warning';

export interface OverlayUi {
  /** Replaces that agent's bubble. ttlMs default: 'say' 4000, 'warning' 6000, 'status'/'waiting' until cleared/replaced. */
  showBubble(agentId: AgentId, text: string, kind?: BubbleKind, ttlMs?: number): void;
  clearBubble(agentId: AgentId): void;
  /** 💭 recall sparkle over the agent. */
  sparkle(agentId: AgentId): void;
  /** Small ✓/✗ puff over the agent (tool.result). */
  puff(agentId: AgentId, ok: boolean): void;
  /** ApprovalCard next to nearAgent (Warden). Allow/Deny → api.resolveApproval(callId, approved). */
  showApproval(a: { callId: string; title: string; preview: string; nearAgent: AgentId }): void;
  closeApproval(callId: string): void;
  /** Inspect card (spec §10); never for 'chipmunk'. */
  openInspect(agentId: AgentId): void;
  closeInspect(): void;
  /** An artifact item flies from the agent up into the Hub (to the layout's dockPoint). */
  flyToHub(agentId: AgentId, label: string): void;
  setReplayBanner(on: boolean): void;
}
export interface OverlayUiProps {
  /** Every bubble/card/banner registers its DOM rect (kinds 'bubble' | 'card' | 'banner'). */
  hit: HitRegistry;
  /** CharacterLayer.screenRect; bubbles/cards follow it every animation frame. */
  getRect(agentId: AgentId): Rect | null;
  layout: DesktopLayout;
  /** Agent rows for the inspect card. */
  store: HubStoreHook;
  api: Pick<AdeApi, 'resolveApproval' | 'wakeAgent' | 'sleepAgent'>;
  shell: Pick<AdeShellApi, 'openHubTab'>;
  onReady(ui: OverlayUi): void;
}
/** src/renderer/overlay/ui/index.tsx exports `OverlayUiLayer` with this type. */
export type OverlayUiComponent = ComponentType<OverlayUiProps>;

// ── AnimationDirector (spec §7) — Lane L4: src/renderer/overlay/director/** ──────

export interface DirectorDeps {
  layer: CharacterLayer;
  speech: SpeechQueue;
  sfx: SfxPlayer;
  ui: OverlayUi;
  getLayout(): DesktopLayout;
  /** Replay runs stored events through an EventPlayer at speed 2 (src/main/fake/eventPlayer.ts, wired in W2a). */
  createPlayer(): EventPlayer<BiomeEvent>;
  getTaskEvents: AdeApi['getTaskEvents'];
  clock?: Clock;
}
export interface AnimationDirector {
  readonly replaying: boolean;
  /** Live events. While replaying they are queued and handled when the replay ends. */
  handle(e: BiomeEvent): void;
  /** Plays a stored task at 2× with the REPLAY banner; resolves when done or stopped. */
  replay(taskId: string): Promise<void>;
  stopReplay(): void;
  /** Hub dragged / work area changed: homes and the dock point move. */
  setLayout(layout: DesktopLayout): void;
  /** The user drags an animal along the ground. False when it is busy, away or docked (no drag then). */
  dragTo?(id: AgentId, x: number): boolean;
  /** The user's own home spot for an animal (null = back to the default spot). */
  setUserSpot?(id: AgentId, x: number | null): void;
  dispose(): void;
}
/** src/renderer/overlay/director/index.ts exports `createAnimationDirector`. */
export type CreateAnimationDirector = (deps: DirectorDeps) => AnimationDirector;

// ── Agent Hub window (spec §9) — Lane L5: src/renderer/hub/** ────────────────────

export interface HubAppProps {
  store: HubStoreHook;
  api: AdeApi;
  shell: AdeShellApi;
}
/** src/renderer/hub/HubApp.tsx exports `HubApp` with this type; src/renderer/hub/main.tsx mounts it. */
export type HubAppComponent = ComponentType<HubAppProps>;
