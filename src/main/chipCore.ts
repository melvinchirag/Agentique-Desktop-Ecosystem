import type { AdeSettings } from '../shared/ipc';
import { EventBus } from './bus/eventBus';
import { createBeaverAgent } from './agents/beaver';
import { createOrganizeToolBindings, sweepOldTrash, type SweepResult } from './agents/beaver/organizeTools';
import { createReadToolBindings } from './agents/beaver/readTools';
import type { FileIndex } from './connectors/fs/fileIndex';
import type { FsShell } from './connectors/fs/fsShell';
import type { SafePathOptions } from './connectors/fs/safePath';
import { createAgentRuntime } from './runtime/agentRuntime';
import { RealClock } from './runtime/clock';
import { MemoryHistoryStore } from './runtime/history';
import { createJobScheduler } from './runtime/jobs';
import { createMoodEngine } from './runtime/mood';
import { MemoryNudgeStore } from './runtime/nudgeStore';
import { createNudgeEngine } from './runtime/nudges';
import { createOrchestrator } from './runtime/orchestrator';
import { createPresenceManager } from './runtime/presence';
import type {
  Approvals, Bus, CalendarSource, Clock, DocumentsApi, EventSink, FileOpsJournal, HistoryStore, InjectionScreen, JobScheduler,
  LlmClient, MoodEngine, NudgeEngine, NudgeStore, Orchestrator, PresenceManager, SpecialistRunner, TimerHandle, WardenGate,
} from './runtime/types';

/**
 * Builds all of Chip: bus → presence → jobs → mood → nudges → history → orchestrator.
 * The app (RealCore) and the offline test rig (buildOfflineChip) both go through here, so tests exercise the real wiring.
 */

/** What a gate or approvals factory may use: they are built after the bus and the job scheduler exist. */
export interface ArchieContext { bus: Bus; clock: Clock; jobs: JobScheduler }

/**
 * Real Archie (Archie spec §14). When present, jobs for `beaver` run in a real AgentRuntime; every other animal
 * still goes to `ChipCoreConfig.runner`. Warden does not exist yet, so the caller supplies the gate and approvals
 * (a stub today; real Warden replaces both).
 */
export interface ArchieWiring {
  llm: LlmClient;                    // Archie's OWN Backboard client; never Chip's (a scripted FakeLlm in tests)
  assistantId: string;
  gate: (ctx: ArchieContext) => WardenGate;
  approvals: (ctx: ArchieContext) => Approvals;
  safe: SafePathOptions;             // allowed roots + Documents (for ADE Trash)
  index: FileIndex;                  // the caller builds it; until it is ready, search falls back to a live scan
  journal: FileOpsJournal;           // local journal, or createCompositeJournal(local, tiger)
  shell: FsShell;                    // the app supplies Electron's; tests use FakeFsShell
  documents?: DocumentsApi;          // Backboard thread documents, for fs_ask_file
  screen?: InjectionScreen;          // Warden's injection screen, when it exists
  startSweep?: boolean;              // default true: sweep ADE Trash once now, then every sweepEveryMs
  sweepEveryMs?: number;             // default 6 h
}

export const TRASH_SWEEP_EVERY_MS = 6 * 60 * 60 * 1000;

export interface ChipCoreConfig {
  llm: LlmClient;                    // Chip's brain: BackboardClient (live) or FakeLlm (tests)
  plannerLlm?: LlmClient;            // the nudge planner's client; default: `llm`
  runner: SpecialistRunner;          // FakeSpecialists today; the real AgentRuntime later
  calendar: CalendarSource;          // FakeCalendar today; Pixel's Google connector later
  settings: () => AdeSettings;
  chipAssistantId: string;
  clock?: Clock;                     // default new RealClock()
  sessionId?: string;                // passed to the EventBus
  nudgeStore?: NudgeStore;           // default new MemoryNudgeStore()   (Tiger: Shafeen's TigerNudgeStore)
  history?: HistoryStore;            // default new MemoryHistoryStore() (Tiger: TigerHistoryStore)
  eventSink?: EventSink;             // optional; subscribed to the bus (Tiger: TigerEventSink)
  timeZone?: string;                 // default: the system zone
  startNudges?: boolean;             // default true
  archie?: ArchieWiring;             // default: none, so `beaver` stays on `runner`
}

export interface ChipCore {
  bus: EventBus; clock: Clock;
  jobs: JobScheduler; presence: PresenceManager; mood: MoodEngine;
  nudges: NudgeEngine; nudgeStore: NudgeStore; history: HistoryStore; orchestrator: Orchestrator;
  /** Hold-to-talk on Chip / the Hub mic (§14.4: no nudges while the user is holding Chip). */
  setUserTalking(on: boolean): void;
  /** Agent Hub do-not-disturb toggle (AdeApi.setDoNotDisturb). */
  setDoNotDisturb(on: boolean): void;
  isUserBusy(): boolean;
  /** Present only when `config.archie` was given. */
  archie?: {
    runtime: SpecialistRunner; gate: WardenGate; approvals: Approvals;
    /** Run the 7-day ADE Trash sweep now (one at a time: a second call joins the one in flight). */
    sweep(): Promise<SweepResult>;
  };
  /** Stops every engine and timer, unsubscribes, then flushes the event sink (if any). Safe to call twice. */
  dispose(): Promise<void>;
}

/** Spec §14.4: no nudge within 20 s of the user's last message. */
export const USER_BUSY_AFTER_MESSAGE_MS = 20_000;

export function createChipCore(config: ChipCoreConfig): ChipCore {
  const { llm, runner, calendar, settings, chipAssistantId, eventSink } = config;
  const clock = config.clock ?? new RealClock();
  const bus = new EventBus({ clock, ...(config.sessionId !== undefined ? { sessionId: config.sessionId } : {}) });
  const unsubscribers: (() => void)[] = [];

  if (eventSink) unsubscribers.push(bus.subscribe((e) => eventSink.enqueue(e)));

  // "Is the user busy": holding Chip, a Chip turn running (agent.status listening/thinking → idle/error), or spoke < 20 s ago.
  let userTalking = false;
  let doNotDisturb = false;
  let chipTurnRunning = false;
  let lastUserMessageAt = Number.NEGATIVE_INFINITY;
  unsubscribers.push(bus.subscribe((e) => {
    if (e.type === 'user.message') lastUserMessageAt = e.ts;
    else if (e.type === 'agent.status' && e.agentId === 'chipmunk') {
      if (e.status === 'listening' || e.status === 'thinking') chipTurnRunning = true;
      else if (e.status === 'idle' || e.status === 'error') chipTurnRunning = false;
    }
  }));
  const isUserBusy = (): boolean =>
    userTalking || chipTurnRunning || clock.now() - lastUserMessageAt < USER_BUSY_AFTER_MESSAGE_MS;

  // Circular wiring: the runtime needs `jobs` (ask_teammate), and `jobs` needs a runner. A lazy runner breaks the cycle.
  let archieRuntime: SpecialistRunner | undefined;
  const routedRunner: SpecialistRunner = config.archie
    ? { run: (agentId, task, ctx) => (agentId === 'beaver' && archieRuntime ? archieRuntime : runner).run(agentId, task, ctx) }
    : runner;

  const presence = createPresenceManager({ bus, clock, settings });
  const jobs = createJobScheduler({ bus, clock, runner: routedRunner, presence, settings });
  const mood = createMoodEngine({ bus, clock, settings, presence });

  const nudgeStore = config.nudgeStore ?? new MemoryNudgeStore();
  const nudges = createNudgeEngine({
    bus, clock, settings, store: nudgeStore, calendar, llm: config.plannerLlm ?? llm,
    chipAssistantId, isUserBusy, isDoNotDisturb: () => doNotDisturb,
  });

  const history = config.history ?? new MemoryHistoryStore({ bus, clock });
  const orchestrator = createOrchestrator({
    bus, clock, llm, jobs, presence, mood, nudges, history, settings, chipAssistantId, timeZone: config.timeZone,
  });

  // Archie: real tools, gate, approvals and the 7-day trash sweep.
  let archie: ChipCore['archie'];
  let sweepTimer: TimerHandle | undefined;
  let sweepInFlight: Promise<SweepResult> | undefined;
  if (config.archie) {
    const a = config.archie;
    const gate = a.gate({ bus, clock, jobs });
    const approvals = a.approvals({ bus, clock, jobs });
    const definition = createBeaverAgent({
      ...createReadToolBindings({
        safe: a.safe, index: a.index, shell: a.shell, clock,
        ...(a.documents ? { documents: a.documents } : {}), ...(a.screen ? { screen: a.screen } : {}),
      }),
      ...createOrganizeToolBindings({ safe: a.safe, index: a.index, journal: a.journal, shell: a.shell, clock }),
    });
    const runtime = createAgentRuntime({
      bus, llm: a.llm, jobs, gate, approvals, settings, agents: [{ definition, assistantId: a.assistantId }],
      ...(a.screen ? { screen: a.screen } : {}),
    });
    archieRuntime = runtime;

    const sweep = (): Promise<SweepResult> => {
      if (sweepInFlight) return sweepInFlight;
      const run: Promise<SweepResult> = sweepOldTrash({ safe: a.safe, journal: a.journal, shell: a.shell, emit: (e) => { bus.emit(e); } })
        .finally(() => { if (sweepInFlight === run) sweepInFlight = undefined; });
      sweepInFlight = run;
      return run;
    };
    archie = { runtime, gate, approvals, sweep };

    if (a.startSweep !== false) {
      const every = a.sweepEveryMs ?? TRASH_SWEEP_EVERY_MS;
      const onFailure = (err: unknown): void => console.error('[chipCore] trash sweep failed', err);
      const tick = (): void => {
        sweepTimer = clock.setTimeout(() => { tick(); void sweep().catch(onFailure); }, every);
      };
      void sweep().catch(onFailure);
      tick();
    }
  }

  presence.start();
  if (config.startNudges !== false) nudges.start();

  let disposed = false;
  const dispose = async (): Promise<void> => {
    if (disposed) return;
    disposed = true;
    if (sweepTimer !== undefined) clock.clearTimeout(sweepTimer);
    archie?.approvals.dispose();
    orchestrator.dispose();
    nudges.dispose();
    mood.dispose();
    presence.dispose();
    for (const off of unsubscribers.splice(0)) off();
    try {
      await eventSink?.flush();
    } catch (err) {
      console.error('[chipCore] event sink flush failed', err);
    }
  };

  return {
    bus, clock, jobs, presence, mood, nudges, nudgeStore, history, orchestrator,
    setUserTalking: (on) => { userTalking = on; },
    setDoNotDisturb: (on) => { doNotDisturb = on; },
    isUserBusy,
    ...(archie ? { archie } : {}),
    dispose,
  };
}
