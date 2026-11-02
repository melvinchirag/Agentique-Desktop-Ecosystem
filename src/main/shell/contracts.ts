/**
 * App-shell contracts shared by main, preload, and renderer (spec 00-APP-SHELL-SPEC.md §3, §11, §12).
 *
 * FROZEN in Wave 0 (01-APP-SHELL-BUILD-LANES.md §3). Lanes never edit this file. A lane that needs a
 * change STOPs and asks the orchestrator; every lane then rebases.
 *
 * Type-only except SHELL_IPC. No Electron, DOM, or Node imports, so the renderer can import types from here.
 */
import type { AgentId } from '../../shared/agents';
import type { BiomeEvent } from '../../shared/events';
import type { AdeApi, AdeSettings } from '../../shared/ipc';
import type { Clock } from '../runtime/types';

// ── Geometry ──────────────────────────────────────────────

/**
 * DIP rectangle. Overlay-local unless a field says "screen": (0,0) is the overlay window's top-left,
 * which equals the primary display's work-area origin. 1 DIP = 1 CSS px in the overlay (zoom 1).
 */
export interface Rect { x: number; y: number; width: number; height: number }
export interface Point { x: number; y: number }

/** Primary-display geometry and shell flags, sent to every window. All values in DIP. */
export interface DisplayLayout {
  workArea: Rect;          // screen coords; the overlay window's bounds always equal this
  displayBounds: Rect;     // screen coords
  scaleFactor: number;     // 1, 1.25, 1.5, ...
  hubBounds: Rect;         // screen coords of the Hub window, current (after drags / collapse)
  hubCollapsed: boolean;
  animalsHidden: boolean;  // calm mode (overlay hidden)
  demoMode: boolean;       // AdeSettings.demoMode
  devMode: boolean;        // !app.isPackaged, or launched with --dev
}

export type PointerMode = 'forward' | 'poll';
export type DemoHotkey = 'nudge' | 'assetLab' | 'hideAnimals';
export type HubTab = 'chat' | 'timeline' | 'memories' | 'pulse' | 'audit' | 'settings' | 'marketplace';

// ── window.adeShell (preload) ─────────────────────────────

/** Shell-only window controls (spec §11). Not part of src/shared. Exposed by the preload as window.adeShell. */
export interface AdeShellApi {
  // overlay → main
  /** main: setIgnoreMouseEvents(!on, on ? undefined : { forward: true }). Callers send only on change. */
  setInteractive(on: boolean): void;
  /** Overlay-local hit shapes, used only in 'poll' pointer mode. Callers throttle to 10 Hz. */
  publishHitShapes(rects: Rect[]): void;

  // any window
  getLayout(): Promise<DisplayLayout>;
  /** Fires on work-area/DPI change, Hub moved or collapsed, animals hidden/shown, demo mode toggled. */
  onLayoutChanged(cb: (layout: DisplayLayout) => void): () => void;
  /** Focus the Hub window and its chat box (short click on Chip). */
  hubFocusChat(): void;
  /** Show a Hub tab, e.g. the inspect card's "What I remember" → ('memories', agentId). */
  openHubTab(tab: HubTab, agentId?: AgentId): void;
  /** Hub status-row click → the overlay opens that animal's inspect card. */
  inspectAgent(agentId: AgentId): void;
  openAssetLab(): void;
  /** Calm mode: hide/show the overlay window. */
  hideAnimals(on: boolean): void;
  /** Delivered to every window. Hotkeys are registered only in demo or dev mode (spec §13). */
  onDemoHotkey(cb: (key: DemoHotkey) => void): () => void;
  /** Pushed to every window after any setSettings (e.g. the overlay follows voiceEnabled). */
  onSettingsChanged(cb: (settings: AdeSettings) => void): () => void;
  /** Hub Audit tab "Replay" → the overlay's director replays that task at 2×. */
  replayTask(taskId: string): void;

  // hub → main
  /** Esc, or after sending a message: hub.blur() so the user's previous app regains focus. */
  blurHub(): void;
  /** 360×560 ↔ 360×56. */
  setHubCollapsed(collapsed: boolean): void;
  /** Hub ⏻ button: close every ADE window and stop the app. */
  quitApp(): void;

  // main → hub
  onFocusChat(cb: () => void): () => void;
  onOpenHubTab(cb: (tab: HubTab, agentId?: AgentId) => void): () => void;

  // main → overlay
  onInspectAgent(cb: (agentId: AgentId) => void): () => void;
  onReplayTask(cb: (taskId: string) => void): () => void;
}

/**
 * IPC channels behind window.adeShell (window.ade uses IPC from src/shared/ipc.ts).
 * "send" = ipcRenderer.send → ipcMain.on; "invoke" = ipcRenderer.invoke → ipcMain.handle;
 * "push" = main → webContents.send. Some channels are used in both directions on purpose.
 */
export const SHELL_IPC = {
  setInteractive: 'shell:overlay:interactive',   // send (overlay only; main ignores other senders)
  publishHitShapes: 'shell:overlay:hit-shapes',  // send (overlay only)
  getLayout: 'shell:layout:get',                 // invoke
  layoutChanged: 'shell:layout:changed',         // push → every window
  hubFocusChat: 'shell:hub:focus-chat',          // send; then push → hub
  openHubTab: 'shell:hub:open-tab',              // send (tab, agentId?); then push → hub
  inspectAgent: 'shell:overlay:inspect',         // send (agentId); then push → overlay
  openAssetLab: 'shell:assetlab:open',           // send
  hideAnimals: 'shell:overlay:hide',             // send (on)
  demoHotkey: 'shell:demo:hotkey',               // push → every window (DemoHotkey)
  blurHub: 'shell:hub:blur',                     // send (hub only)
  setHubCollapsed: 'shell:hub:collapse',         // send (hub only)
  quitApp: 'shell:app:quit',                     // send (hub only)
  settingsChanged: 'shell:settings:changed',     // push → every window (AdeSettings)
  replayTask: 'shell:overlay:replay',            // send (taskId); then push → overlay
} as const;

// ── Main-process pieces ───────────────────────────────────

/** Owns the overlay window's mouse/visibility state (Lane L1, src/main/shell/overlayWindow.ts). */
export interface OverlayController {
  readonly interactive: boolean;
  /** No-op when unchanged. true → setIgnoreMouseEvents(false); false → setIgnoreMouseEvents(true, { forward: true }). */
  setInteractive(on: boolean): void;
  /** Overlay-local shapes; used only in 'poll' mode. */
  setHitShapes(rects: Rect[]): void;
  /** 'forward' is the default (confirmed by X0). 'poll' = screen.getCursorScreenPoint() every 33 ms vs. hit shapes. */
  setPointerMode(mode: PointerMode): void;
  setHidden(hidden: boolean): void;
  /** Screen coords; the overlay always covers the work area. */
  setBounds(workArea: Rect): void;
  destroy(): void;
}

/**
 * Everything window.ade can call, implemented in main. FakeCore now; RealCore (Lane J2) later.
 * registerCoreIpc is the only place that knows which one is in use.
 */
export type CoreAdapter = Omit<AdeApi, 'onEvent'> & {
  /** The core's event stream. registerCoreIpc forwards each event on IPC.event to every window. Returns unsubscribe. */
  subscribe(cb: (e: BiomeEvent) => void): () => void;
  /** Called once both windows have finished loading. FakeCore plays its `boot` script here. */
  start?(): void;
  dispose?(): void;
};

/** Minimal slices of Electron so registerCoreIpc is testable without Electron. */
export interface IpcMainLike {
  handle(channel: string, listener: (event: unknown, ...args: any[]) => unknown): void;
  removeHandler(channel: string): void;
}
export interface WebContentsLike {
  send(channel: string, ...args: unknown[]): void;
  isDestroyed(): boolean;
}

/**
 * src/main/ipc/registerCoreIpc.ts exports `registerCoreIpc: RegisterCoreIpc`.
 * Handles every IPC channel in src/shared/ipc.ts except `event` by calling the adapter method with the
 * same name; forwards adapter events on IPC.event to every live target. Returns a disposer that removes
 * every handler and unsubscribes.
 */
export type RegisterCoreIpc = (
  adapter: CoreAdapter,
  opts: { ipc: IpcMainLike; targets: () => readonly WebContentsLike[] },
) => () => void;

/** src/main/fake/index.ts exports `createFakeCore: CreateFakeCore` (Lane L2). */
export interface FakeCoreOptions {
  clock?: Clock;
  demoMode?: boolean;
  /** Folder holding resources/fake (sample voice clips etc.). Missing files → silence. */
  resourcesDir?: string;
  random?: () => number;
}
export type CreateFakeCore = (opts?: FakeCoreOptions) => CoreAdapter;

// ── EventPlayer (FakeCore scripts in main; Replay in the renderer) ─────

export interface TimedEvent<E> { atMs: number; event: E }   // atMs from the start of playback, at speed 1
export type PlayerState = 'idle' | 'playing' | 'paused' | 'done';

/**
 * Plays timed events on an injectable clock. Pure TS: no Electron, DOM, or Node imports, so the renderer
 * can bundle it too. For Replay of stored events: atMs = e.ts − first.ts, speed 2.
 */
export interface EventPlayer<E> {
  readonly state: PlayerState;
  /** Replaces the queue (sorted by atMs, stable); state → 'idle'. */
  load(items: readonly TimedEvent<E>[]): void;
  /** Starts from the beginning of the loaded items. */
  play(onEvent: (e: E) => void): void;
  pause(): void;
  resume(): void;
  /** Cancels pending timers; state → 'idle'; onDone is NOT called. */
  stop(): void;
  /** > 0. Applies to the items not yet fired. */
  setSpeed(multiplier: number): void;
  /** Called after the last item fires; state → 'done'. Returns unsubscribe. */
  onDone(cb: () => void): () => void;
}

/** src/main/fake/eventPlayer.ts exports `createEventPlayer: CreateEventPlayer` (Lane L2). */
export type CreateEventPlayer = <E>(opts?: { clock?: Clock; speed?: number }) => EventPlayer<E>;
