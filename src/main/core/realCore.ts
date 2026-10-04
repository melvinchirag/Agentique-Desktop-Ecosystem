import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type { AgentId } from '../../shared/agents';
import { AGENTS } from '../../shared/config';
import type { BiomeEvent } from '../../shared/events';
import type { AdeSettings } from '../../shared/ipc';
import { createChipCore } from '../chipCore';
import { createFakeCore } from '../fake';
import { BackboardClient } from '../runtime/backboard';
import { RealClock } from '../runtime/clock';
import type { Bus, SpecialistRunner, VoiceService } from '../runtime/types';
import { assistantIdsFromEnv, readEnvFile, voiceIdsFromEnv, type Env } from '../sponsors/env';
import { BackboardMemoryApi } from '../sponsors/backboardMemory';
import type { CoreAdapter } from '../shell/contracts';
import { createTigerPool, TigerEventSink, adeDataDir } from '../store/tiger';
import { TigerHistoryStore } from '../store/tigerHistory';
import { TigerNudgeStore } from '../store/tigerNudges';
import { TigerQueries } from '../store/tigerQueries';
import { FakeCalendar } from '../testing/fakeCalendar';
import { FakeSpecialists } from '../testing/fakeSpecialists';
import { StubWardenGate } from '../testing/stubWarden';
import { ElevenLabsVoice } from '../voice/elevenlabs';

const ids = Object.keys(AGENTS) as AgentId[];
const silent = () => new ArrayBuffer(0);

/** Only Backboard and Tiger are required for the live Chip path. Voice is optional. */
export function missingRealCoreKeys(env: Env): string[] {
  const missing = ['BACKBOARD_API_KEY', 'BB_ASSISTANT_CHIPMUNK', 'TIGER_DATABASE_URL']
    .filter(key => !env[key]?.trim());
  if (env.TIGER_DATABASE_URL?.trim()) {
    try {
      const url = new URL(env.TIGER_DATABASE_URL);
      if (!url.username || !url.password) missing.push('TIGER_DATABASE_URL credentials');
    } catch { missing.push('TIGER_DATABASE_URL format'); }
  }
  return missing;
}

function defaultSettings(): AdeSettings {
  const model = { llm_provider: 'google', model_name: 'gemini-2.5-flash' };
  return {
    models: Object.fromEntries(ids.map(id => [id, { ...model }])) as AdeSettings['models'],
    voiceEnabled: true, allowedFolders: [], biome: 'forest', demoMode: false,
    installed: Object.fromEntries(ids.map(id => [id, AGENTS[id].tier === 'core'])) as AdeSettings['installed'],
    timers: { sleepAfterSec: 180, dockAfterSec: 600, moodDecaySec: 20 },
    nudges: { enabled: true, quietStart: '23:00', quietEnd: '08:00', maxPerHour: 3 },
  };
}

/** The one specialist seam to replace with AgentRuntime and WardenGate when they merge. */
const specialistBoundary = {
  runner: (clock: RealClock): SpecialistRunner => new FakeSpecialists({ clock }),
  gate: (bus: Bus) => new StubWardenGate(bus),
};

function fallbackCore(resourcesDir: string | undefined, warning: boolean): CoreAdapter {
  const fake = createFakeCore({ demoMode: true, resourcesDir });
  if (!warning) return fake;
  const listeners = new Set<(event: BiomeEvent) => void>();
  const sessionId = randomUUID();
  return {
    ...fake,
    subscribe(cb) {
      listeners.add(cb);
      const off = fake.subscribe(cb);
      return () => { listeners.delete(cb); off(); };
    },
    start() {
      fake.start?.();
      const event: BiomeEvent = {
        id: randomUUID(), ts: Date.now(), sessionId, type: 'wolf.alert', agentId: 'wolf',
        source: 'core', reason: 'Running demo core: missing keys',
      };
      for (const cb of listeners) cb(event);
    },
  };
}

export interface RealCoreOptions {
  demoMode?: boolean;
  resourcesDir?: string;
  env?: Env;
}

/** Main-process adapter. registerCoreIpc forwards this bus to the overlay and Hub. */
export function createRealCore(options: RealCoreOptions = {}): CoreAdapter {
  if (options.demoMode) return fallbackCore(options.resourcesDir, false);
  const env = options.env ?? { ...readEnvFile(join(adeDataDir(), '.env')), ...readEnvFile(join(process.cwd(), '.env')), ...process.env };
  if (missingRealCoreKeys(env).length) return fallbackCore(options.resourcesDir, true);

  let settings = defaultSettings();
  const clock = new RealClock();
  const assistantIds = assistantIdsFromEnv(env);
  const llm = new BackboardClient({ apiKey: env.BACKBOARD_API_KEY!, defaultModel: settings.models.chipmunk });
  const db = createTigerPool(env, process.cwd());
  const queries = new TigerQueries(db);
  const memory = new BackboardMemoryApi(llm, assistantIds);
  const voiceIds = voiceIdsFromEnv(env);
  const voice: VoiceService | undefined = env.ELEVENLABS_API_KEY
    ? new ElevenLabsVoice({ apiKey: env.ELEVENLABS_API_KEY, voiceIds, voiceEnabled: () => settings.voiceEnabled })
    : undefined;
  const eventSink = new TigerEventSink({ db });
  const runner = specialistBoundary.runner(clock);
  const core = createChipCore({
    llm, runner, calendar: new FakeCalendar(clock), settings: () => settings,
    chipAssistantId: assistantIds.chipmunk!, clock, eventSink,
    nudgeStore: new TigerNudgeStore(db), history: new TigerHistoryStore(db, () => clock.now()),
  });
  specialistBoundary.gate(core.bus); // fake specialists make no tool calls yet

  return {
    subscribe: cb => core.bus.subscribe(cb),
    start: () => {
      // createChipCore starts presence before the shell subscribes; repeat the snapshot once both windows are ready.
      for (const agentId of ids) {
        core.bus.emit({ type: 'agent.presence', agentId, presence: core.presence.get(agentId), reason: 'startup' });
      }
    },
    sendMessage: async (text, source) => { core.orchestrator.submitUserMessage(text, { source }); },
    sendVoice: async (audio, mime) => {
      if (!settings.voiceEnabled || !voice) return;
      const { text, cues } = await voice.transcribe(audio, mime);
      if (text) core.orchestrator.submitUserMessage(text, { source: 'voice', voiceCues: cues });
    },
    speak: async (agentId, text, mood) => {
      if (!settings.voiceEnabled || !voice || !voiceIds[agentId]) return silent();
      try { return (await voice.speak(agentId, text, mood)).audio; }
      catch { return silent(); }
    },
    resolveApproval: async () => { /* Fake specialists never request approval. */ },
    wakeAgent: agentId => core.presence.wake(agentId, 'user'),
    sleepAgent: async agentId => { core.presence.dock(agentId); },
    setDoNotDisturb: async on => { core.setDoNotDisturb(on); },
    demoFireNudge: async () => { core.nudges.fireNextNow(); },
    getSettings: async () => structuredClone(settings),
    setSettings: async patch => {
      settings = { ...settings, ...patch, models: { ...settings.models, ...patch.models },
        installed: { ...settings.installed, ...patch.installed },
        timers: { ...settings.timers, ...patch.timers }, nudges: { ...settings.nudges, ...patch.nudges } };
    },
    connectGoogle: async () => { throw new Error('Google connector is not integrated yet.'); },
    disconnectGoogle: async () => { settings = { ...settings, googleEmail: undefined }; },
    learnEmailStyle: async () => { throw new Error('Pixel is not integrated yet.'); },
    getTimeline: (from, to) => queries.timeline(from, to),
    getTaskEvents: taskId => queries.taskEvents(taskId),
    getMemories: async agentId => (await memory.list(agentId)).map(row => ({ id: row.id, memory: row.content })),
    searchMemories: async (agentId, q) => (await memory.search(agentId, q)).map(row => ({ id: row.id, memory: row.content })),
    updateMemory: (agentId, id, text) => memory.update(agentId, id, text),
    deleteMemory: (agentId, id) => memory.remove(agentId, id),
    getPulse: () => queries.pulse(),
    getWardenAudit: limit => queries.wardenAudit(limit),
    dispose: () => { void core.dispose().then(() => eventSink.dispose()).then(() => db.end()); },
  };
}
