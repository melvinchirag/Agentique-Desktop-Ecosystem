// Wave 0 stub. Lane L2 replaces this file.
import { EventBus } from '../bus/eventBus';
import { AGENTS } from '../../shared/config';
import type { AgentId, ModelChoice } from '../../shared/agents';
import type { AdeSettings } from '../../shared/ipc';
import type { CreateFakeCore, CoreAdapter } from '../shell/contracts';

export const createFakeCore: CreateFakeCore = (opts = {}): CoreAdapter => {
  const bus = new EventBus({ clock: opts.clock });
  const ids = Object.keys(AGENTS) as AgentId[];
  const model: ModelChoice = { llm_provider: 'openai', model_name: 'gpt-4o' };
  let settings: AdeSettings = {
    models: Object.fromEntries(ids.map(id => [id, { ...model }])) as Record<AgentId, ModelChoice>,
    voiceEnabled: true,
    allowedFolders: [],
    biome: 'forest',
    demoMode: opts.demoMode ?? false,
    installed: Object.fromEntries(ids.map(id => [id, AGENTS[id].tier === 'core'])) as Record<AgentId, boolean>,
    timers: { sleepAfterSec: 180, dockAfterSec: 600, moodDecaySec: 20 },
    nudges: { enabled: true, quietStart: '23:00', quietEnd: '08:00', maxPerHour: 3 },
  };
  return {
    subscribe: cb => bus.subscribe(cb),
    start: () => {
      bus.emit({ type: 'agent.presence', agentId: 'chipmunk', presence: 'active', reason: 'startup' });
      bus.emit({ type: 'agent.say', agentId: 'chipmunk', text: 'Hi! The shell is alive.', bubble: 'Hi!', priority: 'chip' });
    },
    sendMessage: async (text, source) => {
      bus.emit({ type: 'user.message', agentId: 'chipmunk', text, source });
      bus.emit({ type: 'agent.say', agentId: 'chipmunk', text, bubble: text.slice(0, 48), priority: 'chip' });
    },
    sendVoice: async () => {},
    speak: async () => new ArrayBuffer(0),
    resolveApproval: async () => {},
    wakeAgent: async () => {},
    setDoNotDisturb: async () => {},
    demoFireNudge: async () => {},
    getSettings: async () => settings,
    setSettings: async patch => { settings = { ...settings, ...patch }; },
    connectGoogle: async () => ({ email: '' }),
    learnEmailStyle: async () => ({ sampled: 0 }),
    getTimeline: async () => [],
    getTaskEvents: async () => [],
    getMemories: async () => [],
    searchMemories: async () => [],
    updateMemory: async () => {},
    deleteMemory: async () => {},
    getPulse: async () => ({}),
    getWardenAudit: async () => [],
  };
};
