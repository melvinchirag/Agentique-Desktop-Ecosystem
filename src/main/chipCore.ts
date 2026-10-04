import type { AdeSettings } from '../shared/ipc';
import { EventBus } from './bus/eventBus';
import { RealClock } from './runtime/clock';
import { MemoryHistoryStore } from './runtime/history';
import { createJobScheduler } from './runtime/jobs';
import { createMoodEngine } from './runtime/mood';
import { MemoryNudgeStore } from './runtime/nudgeStore';
import { createNudgeEngine } from './runtime/nudges';
import { createOrchestrator } from './runtime/orchestrator';
import { createPresenceManager } from './runtime/presence';
import type {
  CalendarSource, Clock, EventSink, HistoryStore, JobScheduler, LlmClient, MoodEngine, NudgeEngine, NudgeStore, Orchestrator,
  PresenceManager, SpecialistRunner,
} from './runtime/types';

/**
 * Builds all of Chip: bus → presence → jobs → mood → nudges → history → orchestrator.
 * The app (RealCore) and the offline test rig (buildOfflineChip) both go through here, so tests exercise the real wiring.
 */

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

  const presence = createPresenceManager({ bus, clock, settings });
  const jobs = createJobScheduler({ bus, clock, runner, presence, settings });
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

  presence.start();
  if (config.startNudges !== false) nudges.start();

  let disposed = false;
  const dispose = async (): Promise<void> => {
    if (disposed) return;
    disposed = true;
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
    dispose,
  };
}
