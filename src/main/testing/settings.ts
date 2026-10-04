import type { AgentId, ModelChoice } from '../../shared/agents';
import { AGENTS } from '../../shared/config';
import type { AdeSettings } from '../../shared/ipc';

const ALL_IDS = Object.keys(AGENTS) as AgentId[];
const DEFAULT_MODEL: ModelChoice = { llm_provider: 'openai', model_name: 'test-model' };

/**
 * Default settings for tests: the 6 core animals installed, extras not; normal timers
 * (180 / 600 / 20 s); nudges on with quiet hours 23:00–08:00 and max 3 per hour.
 * Pass a patch to override; nested objects are merged one level deep.
 */
export function makeTestSettings(patch: Partial<AdeSettings> = {}): AdeSettings {
  const base: AdeSettings = {
    models: Object.fromEntries(ALL_IDS.map((id) => [id, DEFAULT_MODEL])) as Record<AgentId, ModelChoice>,
    voiceEnabled: false,
    allowedFolders: [],
    biome: 'forest',
    demoMode: false,
    installed: Object.fromEntries(ALL_IDS.map((id) => [id, AGENTS[id].tier === 'core'])) as Record<AgentId, boolean>,
    timers: { sleepAfterSec: 180, dockAfterSec: 600, moodDecaySec: 20 },
    nudges: { enabled: true, quietStart: '23:00', quietEnd: '08:00', maxPerHour: 3 },
  };
  return {
    ...base,
    ...patch,
    installed: { ...base.installed, ...patch.installed },
    timers: { ...base.timers, ...patch.timers },
    nudges: { ...base.nudges, ...patch.nudges },
  };
}

/** Demo-mode timers from DECISIONS §6: 30 s / 60 s / 20 s. */
export const DEMO_TIMERS: AdeSettings['timers'] = { sleepAfterSec: 30, dockAfterSec: 60, moodDecaySec: 20 };
