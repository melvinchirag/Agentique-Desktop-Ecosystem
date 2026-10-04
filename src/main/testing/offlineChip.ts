import type { BiomeEvent } from '../../shared/events';
import type { AdeSettings } from '../../shared/ipc';
import type { EventBus } from '../bus/eventBus';
import { createChipCore } from '../chipCore';
import { FakeClock, type RealClock } from '../runtime/clock';
import { MemoryNudgeStore } from '../runtime/nudgeStore';
import type {
  CalendarSource, Clock, HistoryStore, JobScheduler, LlmClient, LlmResponse, MoodEngine, NudgeEngine, Orchestrator, PresenceManager,
} from '../runtime/types';
import { FakeCalendar } from './fakeCalendar';
import { completed, FakeLlm } from './fakeLlm';
import { FakeSpecialists } from './fakeSpecialists';
import { makeTestSettings } from './settings';

/**
 * The whole Chip stack on fakes: a thin wrapper around createChipCore() (src/main/chipCore.ts),
 * so the tests exercise exactly the wiring the app uses.
 * Used by the scenario tests (C1–C19) and by scripts/chip-cli.ts.
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

  const nudgeStore = new MemoryNudgeStore();
  const core = createChipCore({
    llm, plannerLlm: opts.plannerLlm ?? noNudgesPlanner, runner: specialists, calendar, settings,
    chipAssistantId: CHIP_ASSISTANT_ID, clock, nudgeStore,
    timeZone: opts.timeZone ?? 'America/Detroit',
    ...(opts.startNudges !== undefined ? { startNudges: opts.startNudges } : {}),
  });

  return {
    bus: core.bus, clock: core.clock, llm, specialists,
    jobs: core.jobs, presence: core.presence, mood: core.mood, nudges: core.nudges,
    nudgeStore, history: core.history, orchestrator: core.orchestrator, settings, setSettings,
    events: () => core.bus.recent(),
    dispose() {
      void core.dispose();
    },
  };
}
