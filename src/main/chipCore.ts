import type { AdeSettings } from '../shared/ipc';
import type { ToolDefinition } from '../shared/tools';
import { createWarden, type Warden, type WardenOptions } from './wolf';
import type { ToolRegistry } from './wolf/gate';
import { EventBus } from './bus/eventBus';
import { createBeaverAgent } from './agents/beaver';
import { createEagleAgent, type EagleToolDeps } from './agents/eagle';
import { createAntsAgent, createSwarmPlanStore, parsePlanSummary, type SwarmPlan, type SwarmPlanStore } from './agents/ants';
import { createOrganizeToolBindings, sweepOldTrash, type SweepResult } from './agents/beaver/organizeTools';
import { createReadToolBindings } from './agents/beaver/readTools';
import { createCompositeJournal, type CompositeJournal } from './connectors/fs/compositeJournal';
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
  LlmClient, MoodEngine, NudgeEngine, NudgeStore, Orchestrator, SpecialistId, SpecialistRunner, TimerHandle, WardenGate,
} from './runtime/types';

/**
 * Builds all of Chip: bus → presence → jobs → mood → nudges → history → orchestrator.
 * The app (RealCore) and the offline test rig (buildOfflineChip) both go through here, so tests exercise the real wiring.
 */

/** What a gate or approvals factory may use: they are built after the bus and the job scheduler exist. */
export interface ArchieContext { bus: Bus; clock: Clock; jobs: JobScheduler }

/** Real Archie wiring. The shared Warden is the default; tests may supply stand-ins. */
export interface ArchieWiring {
  llm: LlmClient;                    // Archie's OWN Backboard client; never Chip's (a scripted FakeLlm in tests)
  assistantId: string;
  gate?: (ctx: ArchieContext) => WardenGate;
  approvals?: (ctx: ArchieContext) => Approvals;
  safe: SafePathOptions;             // allowed roots + Documents (for ADE Trash)
  index: FileIndex;                  // the caller builds it; until it is ready, search falls back to a live scan
  journal: FileOpsJournal;           // local primary journal
  tigerJournal?: FileOpsJournal;     // optional non-blocking copy; never consulted for undo
  shell: FsShell;                    // the app supplies Electron's; tests use FakeFsShell
  documents?: DocumentsApi;          // Backboard thread documents, for fs_ask_file
  screen?: InjectionScreen;          // optional override of the real Warden screen
  startSweep?: boolean;              // default true: sweep ADE Trash once now, then every sweepEveryMs
  sweepEveryMs?: number;             // default 6 h
}

export interface EagleWiring extends EagleToolDeps {
  llm: LlmClient;
  assistantId: string;
  gate?: (ctx: ArchieContext) => WardenGate;
  approvals?: (ctx: ArchieContext) => Approvals;
  screen?: InjectionScreen;
  recordFindings?: (title: string, summary: string) => Promise<void>;
}

export interface AntsWiring {
  llm: LlmClient;
  assistantId: string;
  gate?: (ctx: ArchieContext) => WardenGate;
  approvals?: (ctx: ArchieContext) => Approvals;
  screen?: InjectionScreen;
  /** Optional Tiger plan_items adapter; the local plan remains available without it. */
  appendItems?: (plan: SwarmPlan) => Promise<void>;
}

export const TRASH_SWEEP_EVERY_MS = 6 * 60 * 60 * 1000;
const SAFE_SWEEP_ERRORS = new Set(['INVALID_BATCH_ID', 'TRASH_LOCATION_CHANGED', 'NOT_A_FOLDER', 'ENOENT', 'EPERM', 'EBUSY']);

export interface ChipCoreConfig {
  llm: LlmClient;                    // Chip's brain: BackboardClient (live) or FakeLlm (tests)
  plannerLlm?: LlmClient;            // the nudge planner's client; default: `llm`
  runner: SpecialistRunner;          // fallback for specialists without a registered runtime
  calendar: CalendarSource;
  settings: () => AdeSettings;
  chipAssistantId: string;
  clock?: Clock;                     // default new RealClock()
  sessionId?: string;                // passed to the EventBus
  nudgeStore?: NudgeStore;           // default new MemoryNudgeStore()   (Tiger: Shafeen's TigerNudgeStore)
  history?: HistoryStore;            // default new MemoryHistoryStore() (Tiger: TigerHistoryStore)
  plans?: { completionToday(): Promise<{ text: string }> };
  eventSink?: EventSink;             // optional; subscribed to the bus (Tiger: TigerEventSink)
  timeZone?: string;                 // default: the system zone
  startNudges?: boolean;             // default true
  archie?: ArchieWiring;             // default: none, so `beaver` stays on `runner`
  warden?: Omit<WardenOptions, 'bus' | 'clock' | 'jobs' | 'presence' | 'settings' | 'registry'> & { registry?: ToolRegistry };
  eagle?: EagleWiring;
  ants?: AntsWiring;
}

export interface ChipCore {
  bus: EventBus; clock: Clock;
  jobs: JobScheduler; presence: ReturnType<typeof createPresenceManager>; mood: MoodEngine;
  nudges: NudgeEngine; nudgeStore: NudgeStore; history: HistoryStore; orchestrator: Orchestrator;
  /** Hold-to-talk on Chip / the Hub mic (§14.4: no nudges while the user is holding Chip). */
  setUserTalking(on: boolean): void;
  /** Agent Hub do-not-disturb toggle (AdeApi.setDoNotDisturb). */
  setDoNotDisturb(on: boolean): void;
  isUserBusy(): boolean;
  warden?: Warden;
  /** Present only when `config.archie` was given. */
  archie?: {
    runtime: SpecialistRunner; gate: WardenGate; approvals: Approvals;
    /** Run the 7-day ADE Trash sweep now (one at a time: a second call joins the one in flight). */
    sweep(): Promise<SweepResult>;
  };
  eagle?: { runtime: SpecialistRunner; gate: WardenGate; approvals: Approvals };
  ants?: { runtime: SpecialistRunner; gate: WardenGate; approvals: Approvals; plans: SwarmPlanStore };
  /** One live specialist registry; a missing entry uses the configured stand-in runner. */
  registerSpecialist(agentId: SpecialistId, runtime: SpecialistRunner): void;
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
  let eagleRuntime: SpecialistRunner | undefined;
  const specialists: Partial<Record<SpecialistId, SpecialistRunner>> = {};
  const routedRunner: SpecialistRunner = {
    run: (agentId, task, ctx) => {
      const registered = specialists[agentId];
      if (registered) return registered.run(agentId, task, ctx);
      return runner.run(agentId, task, ctx);
    },
  };

  const presence = createPresenceManager({ bus, clock, settings });
  const jobs = createJobScheduler({ bus, clock, runner: routedRunner, presence, settings });
  let archieTools: readonly ToolDefinition[] | undefined;
  let eagleTools: readonly ToolDefinition[] | undefined;
  let antsTools: readonly ToolDefinition[] | undefined;
  const warden = config.archie || config.eagle || config.ants || config.warden ? createWarden({
    ...config.warden, bus, clock, jobs, presence, settings,
    documentsRoot: config.warden?.documentsRoot ?? config.archie?.safe.documentsRoot,
    registry: agentId => {
      const registry = config.warden?.registry;
      const extra = typeof registry === 'function' ? registry(agentId) : registry?.[agentId];
      const built = agentId === 'beaver' ? archieTools : agentId === 'eagle' ? eagleTools : agentId === 'ants' ? antsTools : undefined;
      return built ? [...built, ...(extra ?? [])] : extra;
    },
  }) : undefined;
  const mood = createMoodEngine({ bus, clock, settings, presence });

  const nudgeStore = config.nudgeStore ?? new MemoryNudgeStore();
  const nudges = createNudgeEngine({
    bus, clock, settings, store: nudgeStore, calendar, llm: config.plannerLlm ?? llm,
    chipAssistantId, isUserBusy, isDoNotDisturb: () => doNotDisturb, plans: config.plans,
  });

  const history = config.history ?? new MemoryHistoryStore({ bus, clock });
  const orchestrator = createOrchestrator({
    bus, clock, llm, jobs, presence, mood, nudges, history, settings, chipAssistantId, timeZone: config.timeZone,
  });

  // Archie: real tools, gate, approvals and the 7-day trash sweep.
  let archie: ChipCore['archie'];
  let archieJournal: CompositeJournal | undefined;
  let sweepTimer: TimerHandle | undefined;
  let sweepInFlight: Promise<SweepResult> | undefined;
  let disposed = false;
  let archieApprovals: Approvals | undefined;
  let eagle: ChipCore['eagle'];
  let ants: ChipCore['ants'];
  try {
  if (config.archie) {
    try {
    const a = config.archie;
    const journal = createCompositeJournal(a.journal, a.tigerJournal);
    archieJournal = journal;
    const gate = a.gate?.({ bus, clock, jobs }) ?? warden!.gate;
    const approvals = a.approvals?.({ bus, clock, jobs }) ?? warden!.approvals;
    archieApprovals = approvals;
    const screen = a.screen ?? warden!.screen;
    const read = createReadToolBindings({
      safe: a.safe, index: a.index, shell: a.shell, clock,
      ...(a.documents ? { documents: a.documents } : {}), screen,
    });
    // Talking files (spec §6.4): remember which file a job described, so the finished job can emit artifact(file_note).
    const described = new Map<string, string>();
    const describe = read.fs_describe!;
    read.fs_describe = {
      ...describe,
      async execute(input, toolCtx) {
        described.delete(toolCtx.jobId);
        const out = await describe.execute(input, toolCtx);
        const name = out && typeof out === 'object' && !('error' in out) ? (out as { name?: unknown }).name : undefined;
        if (typeof name === 'string') described.set(toolCtx.jobId, name);
        return out;
      },
    };
    const definition = createBeaverAgent({
      ...read,
      ...createOrganizeToolBindings({ safe: a.safe, index: a.index, journal, shell: a.shell, clock }),
    });
    archieTools = definition.tools;
    const runtime = createAgentRuntime({
      bus, llm: a.llm, jobs, gate, approvals, settings, agents: [{ definition, assistantId: a.assistantId }],
      screen,
    });
    archieRuntime = {
      async run(agentId, task, runCtx) {
        try {
          const result = await runtime.run(agentId, task, runCtx);
          const name = described.get(runCtx.jobId);
          if (!name || !result.ok || !result.say) return result;
          bus.emit({ type: 'artifact', agentId: 'beaver', taskId: runCtx.taskId, kind: 'file_note', title: name, data: { name, line: result.say } });
          return { ...result, artifacts: [...result.artifacts, { kind: 'file_note', title: name }] };
        } finally {
          described.delete(runCtx.jobId);
        }
      },
    };

    const sweep = (): Promise<SweepResult> => {
      if (disposed) return Promise.reject(new Error('Archie core is disposed'));
      if (sweepInFlight) return sweepInFlight;
      const run: Promise<SweepResult> = sweepOldTrash({ safe: a.safe, journal, shell: a.shell, emit: (e) => { bus.emit(e); } })
        .then((result) => ({ ...result, failed: result.failed.map((item) => ({
          ...item, error: SAFE_SWEEP_ERRORS.has(item.error) ? item.error : 'SWEEP_FAILED',
        })) }))
        .catch(() => { throw new Error('Archie trash sweep failed'); })
        .finally(() => { if (sweepInFlight === run) sweepInFlight = undefined; });
      sweepInFlight = run;
      return run;
    };
    archie = { runtime: archieRuntime, gate, approvals, sweep };
    specialists.beaver = archieRuntime;

    if (a.startSweep !== false) {
      const every = a.sweepEveryMs !== undefined && Number.isFinite(a.sweepEveryMs) && a.sweepEveryMs > 0
        ? a.sweepEveryMs : TRASH_SWEEP_EVERY_MS;
      const onFailure = (): void => console.error('[chipCore] trash sweep failed');
      const tick = (): void => {
        if (disposed) return;
        sweepTimer = clock.setTimeout(() => {
          if (disposed) return;
          tick();
          void sweep().catch(onFailure);
        }, every);
      };
      void sweep().catch(onFailure);
      tick();
    }
    } catch (error) { console.error('[chipCore] Archie construction failed; using fallback', error); }
  }

  if (config.eagle) {
    try {
    const e = config.eagle;
    const gate = e.gate?.({ bus, clock, jobs }) ?? warden!.gate;
    const approvals = e.approvals?.({ bus, clock, jobs }) ?? warden!.approvals;
    const definition = createEagleAgent(e);
    eagleTools = definition.tools;
    const runtime = createAgentRuntime({
      bus, llm: e.llm, jobs, gate, approvals, settings,
      agents: [{ definition, assistantId: e.assistantId }], screen: e.screen ?? warden!.screen,
    });
    eagleRuntime = {
      async run(agentId, task, runCtx) {
        bus.emit({ type: 'agent.status', agentId: 'eagle', taskId: runCtx.taskId, status: 'away', detail: 'Scanning the web…' });
        try {
          const result = await runtime.run(agentId, task, runCtx);
          if (result.ok) await e.recordFindings?.(task, result.summary);
          return result;
        }
        finally { bus.emit({ type: 'agent.status', agentId: 'eagle', taskId: runCtx.taskId, status: 'done' }); }
      },
    };
    eagle = { runtime: eagleRuntime, gate, approvals };
    specialists.eagle = eagleRuntime;
    } catch (error) { console.error('[chipCore] Scout construction failed; using fallback', error); }
  }

  if (config.ants) {
    const a = config.ants;
    const gate = a.gate?.({ bus, clock, jobs }) ?? warden!.gate;
    const approvals = a.approvals?.({ bus, clock, jobs }) ?? warden!.approvals;
    const plans = createSwarmPlanStore(a.appendItems);
    const definition = createAntsAgent(plans);
    antsTools = definition.tools;
    const runtime = createAgentRuntime({
      bus, llm: a.llm, jobs, gate, approvals, settings,
      agents: [{ definition, assistantId: a.assistantId,
        memory: { normal: 'Auto', help: 'Auto' } }],
      screen: a.screen ?? warden!.screen,
    });
    const antsRuntime: SpecialistRunner = {
      async run(agentId, task, runCtx) {
        bus.emit({ type: 'agent.status', agentId: 'ants', taskId: runCtx.taskId, status: 'working', detail: 'Assembling a plan…' });
        try {
          const result = await runtime.run(agentId, task, runCtx);
          if (result.ok && !parsePlanSummary(result.summary)) {
            return { ...result, ok: false, summary: 'Swarm returned an invalid plan JSON block.' };
          }
          return result;
        } finally { bus.emit({ type: 'agent.status', agentId: 'ants', taskId: runCtx.taskId, status: 'done' }); }
      },
    };
    ants = { runtime: antsRuntime, gate, approvals, plans };
    specialists.ants = antsRuntime;
  }

  presence.start();
  if (config.startNudges !== false) nudges.start();
  } catch (error) {
    disposed = true;
    if (sweepTimer !== undefined) clock.clearTimeout(sweepTimer);
    try { archieApprovals?.dispose(); } catch { /* Preserve the construction failure. */ }
    try { warden?.dispose(); } catch { /* Preserve the construction failure. */ }
    orchestrator.dispose();
    nudges.dispose();
    mood.dispose();
    presence.dispose();
    for (const off of unsubscribers.splice(0)) off();
    throw error;
  }

  let disposePromise: Promise<void> | undefined;
  const dispose = (): Promise<void> => {
    if (disposePromise) return disposePromise;
    disposed = true;
    disposePromise = (async () => {
      if (sweepTimer !== undefined) clock.clearTimeout(sweepTimer);
      for (const service of new Set([archie?.approvals, eagle?.approvals, ants?.approvals])) {
        if (service && service !== warden?.approvals) {
          try { service.dispose(); } catch { console.error('[chipCore] approvals disposal failed'); }
        }
      }
      try { warden?.dispose(); }
      catch { console.error('[chipCore] Warden disposal failed'); }
      orchestrator.dispose();
      nudges.dispose();
      mood.dispose();
      presence.dispose();
      // A startup or timer sweep may still be in flight. Keep subscribers until its final status is emitted.
      if (sweepInFlight) await sweepInFlight.catch(() => undefined);
      await archieJournal?.flush();
      for (const off of unsubscribers.splice(0)) off();
      try { await eventSink?.flush(); }
      catch { console.error('[chipCore] event sink flush failed'); }
    })();
    return disposePromise;
  };

  return {
    bus, clock, jobs, presence, mood, nudges, nudgeStore, history, orchestrator,
    setUserTalking: (on) => { userTalking = on; },
    setDoNotDisturb: (on) => { doNotDisturb = on; },
    isUserBusy,
    registerSpecialist: (agentId, runtime) => { specialists[agentId] = runtime; },
    ...(archie ? { archie } : {}), ...(eagle ? { eagle } : {}), ...(ants ? { ants } : {}),
    ...(warden ? { warden } : {}),
    dispose,
  };
}
