import type { BiomeEvent } from '../../shared/events';
import type { AdeSettings } from '../../shared/ipc';
import { EventBus } from '../bus/eventBus';
import { FakeClock, type RealClock } from '../runtime/clock';
import { MemoryHistoryStore } from '../runtime/history';
import { createJobScheduler } from '../runtime/jobs';
import { createMoodEngine } from '../runtime/mood';
import { MemoryNudgeStore } from '../runtime/nudgeStore';
import { createNudgeEngine } from '../runtime/nudges';
import { createOrchestrator } from '../runtime/orchestrator';
import { createPresenceManager } from '../runtime/presence';
import type {
  CalendarSource, Clock, HistoryStore, JobScheduler, LlmClient, LlmResponse, MoodEngine, NudgeEngine, Orchestrator, PresenceManager,
} from '../runtime/types';
import { FakeCalendar } from './fakeCalendar';
import { completed, FakeLlm } from './fakeLlm';
import { FakeSpecialists } from './fakeSpecialists';
import { makeTestSettings } from './settings';

/**
 * The whole Chip stack on fakes: bus → presence → jobs → mood → nudges → history → orchestrator.
 * Used by the scenario tests (C1–C19) and by scripts/chip-cli.ts. Lane J1 later turns this into createChipCore().
 */

export interface OfflineChipOptions {
  clock?: FakeClock | RealClock;               // default new FakeClock()
  llm?: LlmClient;                             // default new FakeLlm([])
  specialists?: FakeSpecialists;               // default new FakeSpecialists({ clock })
  settings?: AdeSettings;                      // default makeTestSettings()
  calendar?: CalendarSource;                   // default new FakeCalendar(clock)
  plannerLlm?: LlmClient;                      // the nudge planner's OWN client; default: always answers {"nudges":[]}
  startNudges?: boolean;                       // default true
  timeZone?: string;                           // default 'America/Detroit'
}

export interface OfflineChip {
  bus: EventBus; clock: Clock; llm: LlmClient; specialists: FakeSpecialists;
  jobs: JobScheduler; presence: PresenceManager; mood: MoodEngine; nudges: NudgeEngine;
  nudgeStore: MemoryNudgeStore; history: HistoryStore; orchestrator: Orchestrator;
  settings: () => AdeSettings; setSettings(patch: Partial<AdeSettings>): void;
  events(): BiomeEvent[];                      // bus.recent()
  dispose(): void;
}

const CHIP_ASSISTANT_ID = 'chip-asst';
const USER_BUSY_MS = 20_000;                   // spec §14.4: not within 20 s of the user's last message

/** The planner's default client: no nudges, ever. It must never share Chip's scripted client (lane G audit). */
const noNudgesPlanner: LlmClient = {
  async send(): Promise<LlmResponse> {
    return completed('{"nudges":[]}');
  },
  async submitToolOutputs(): Promise<LlmResponse> {
    throw new Error('offlineChip: the nudge planner never uses tools');
  },
};

export function buildOfflineChip(opts: OfflineChipOptions = {}): OfflineChip {
  const clock = opts.clock ?? new FakeClock();
  const llm = opts.llm ?? new FakeLlm([]);
  const specialists = opts.specialists ?? new FakeSpecialists({ clock });
  const calendar = opts.calendar ?? new FakeCalendar(clock);

  let current = opts.settings ?? makeTestSettings();
  const settings = (): AdeSettings => current;
  const setSettings = (patch: Partial<AdeSettings>): void => {
    current = makeTestSettings({ ...current, ...patch });           // merges installed / timers / nudges one level deep
  };

  const bus = new EventBus({ clock });

  // "Is the user busy": a Chip turn is running (agent.status listening/thinking → idle/error) or they spoke < 20 s ago.
  let chipTurnRunning = false;
  let lastUserMessageAt = Number.NEGATIVE_INFINITY;
  const unsubscribeBusy = bus.subscribe((e) => {
    if (e.type === 'user.message') lastUserMessageAt = e.ts;
    else if (e.type === 'agent.status' && e.agentId === 'chipmunk') {
      if (e.status === 'listening' || e.status === 'thinking') chipTurnRunning = true;
      else if (e.status === 'idle' || e.status === 'error') chipTurnRunning = false;
    }
  });
  const isUserBusy = (): boolean => chipTurnRunning || clock.now() - lastUserMessageAt < USER_BUSY_MS;

  const presence = createPresenceManager({ bus, clock, settings });
  const jobs = createJobScheduler({ bus, clock, runner: specialists, presence, settings });
  const mood = createMoodEngine({ bus, clock, settings, presence });

  const nudgeStore = new MemoryNudgeStore();
  const nudges = createNudgeEngine({
    bus, clock, settings, store: nudgeStore, calendar, llm: opts.plannerLlm ?? noNudgesPlanner,
    chipAssistantId: CHIP_ASSISTANT_ID, isUserBusy,
  });

  const history = new MemoryHistoryStore({ bus, clock });
  const orchestrator = createOrchestrator({
    bus, clock, llm, jobs, presence, mood, nudges, history, settings,
    chipAssistantId: CHIP_ASSISTANT_ID, timeZone: opts.timeZone ?? 'America/Detroit',
  });

  presence.start();
  if (opts.startNudges !== false) nudges.start();

  return {
    bus, clock, llm, specialists, jobs, presence, mood, nudges, nudgeStore, history, orchestrator, settings, setSettings,
    events: () => bus.recent(),
    dispose() {
      orchestrator.dispose();
      nudges.dispose();
      mood.dispose();
      presence.dispose();
      unsubscribeBusy();
    },
  };
}
