import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { AgentId } from '../../shared/agents';
import { AGENTS } from '../../shared/config';
import type { BiomeEvent } from '../../shared/events';
import type { AdeSettings } from '../../shared/ipc';
import { createChipCore } from '../chipCore';
import { createPixelAgent } from '../agents/workspace';
import { createCalendarTools, GoogleCalendarSource } from '../agents/workspace/calendarTools';
import { createGmailTools } from '../agents/workspace/gmailTools';
import { createDriveTools } from '../agents/workspace/driveTools';
import { createDocsTools } from '../agents/workspace/docsTools';
import { createSheetsTools } from '../agents/workspace/sheetsTools';
import { createStyleTool } from '../agents/workspace/styleTool';
import { withTempFile } from '../agents/workspace/tempFile';
import { PixelRegistry } from '../agents/workspace/registry';
import { StyleStore } from '../agents/workspace/style/styleStore';
import { learnEmailStyle } from '../agents/workspace/style/learner';
import { FileIndex } from '../connectors/fs/fileIndex';
import { LocalFileOpsJournal } from '../connectors/fs/localJournal';
import { safePath } from '../connectors/fs/safePath';
import type { FsShell } from '../connectors/fs/fsShell';
import { GoogleAuthService } from '../connectors/google/googleAuthService';
import { SafeStorageTokenStore, type SafeStorageLike } from '../connectors/google/tokenStore';
import { GoogleHttp } from '../connectors/google/http';
import { GmailClient } from '../connectors/google/gmailClient';
import { CalendarClient } from '../connectors/google/calendarClient';
import { DriveClient } from '../connectors/google/driveClient';
import { DocsClient } from '../connectors/google/docsClient';
import { SheetsClient } from '../connectors/google/sheetsClient';
import type { GoogleApi } from '../connectors/google/api';
import { BackboardDocuments } from '../sponsors/backboardDocuments';
import { createAgentRuntime } from '../runtime/agentRuntime';
import { createFakeCore } from '../fake';
import { BackboardClient } from '../runtime/backboard';
import { RealClock } from '../runtime/clock';
import type { Approvals, SpecialistRunner, VoiceService } from '../runtime/types';
import { assistantIdsFromEnv, readEnvFile, voiceIdsFromEnv, type Env } from '../sponsors/env';
import { BackboardMemoryApi } from '../sponsors/backboardMemory';
import type { CoreAdapter } from '../shell/contracts';
import { createTigerPool, TigerEventSink, adeDataDir } from '../store/tiger';
import { TigerHistoryStore } from '../store/tigerHistory';
import { TigerNudgeStore } from '../store/tigerNudges';
import { TigerQueries } from '../store/tigerQueries';
import { FakeCalendar } from '../testing/fakeCalendar';
import { StubWardenGate } from '../testing/stubWarden';
import { handleStandInSendPost, StandInSpecialists } from './standInSpecialists';
import { ElevenLabsVoice } from '../voice/elevenlabs';
import { createApprovals } from './approvals';
import { createInjectionScreen } from './injectionScreen';

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

function defaultSettings(options: RealCoreOptions): AdeSettings {
  const model = { llm_provider: 'google', model_name: 'gemini-2.5-flash' };
  return {
    models: Object.fromEntries(ids.map(id => [id, { ...model }])) as AdeSettings['models'],
    voiceEnabled: true, allowedFolders: [options.desktopRoot ?? join(homedir(), 'Desktop'), options.documentsRoot ?? join(homedir(), 'Documents'), options.downloadsRoot ?? join(homedir(), 'Downloads')], biome: 'forest', demoMode: !!options.demoTimers,
    installed: Object.fromEntries(ids.map(id => [id, AGENTS[id].tier === 'core'])) as AdeSettings['installed'],
    timers: { sleepAfterSec: options.demoTimers ? 30 : 180, dockAfterSec: options.demoTimers ? 60 : 600, moodDecaySec: 20 },
    nudges: { enabled: true, quietStart: '23:00', quietEnd: '08:00', maxPerHour: 3 },
  };
}

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
  openExternal?: (url: string) => Promise<void>;
  documentsRoot?: string;
  desktopRoot?: string;
  downloadsRoot?: string;
  safeStorage?: SafeStorageLike;
  fsShell?: FsShell;
  demoTimers?: boolean;
  onSettingsChanged?: (settings: AdeSettings) => void;
}

/** Main-process adapter. registerCoreIpc forwards this bus to the overlay and Hub. */
export function createRealCore(options: RealCoreOptions = {}): CoreAdapter {
  if (options.demoMode) return fallbackCore(options.resourcesDir, false);
  const env = options.env ?? { ...readEnvFile(join(adeDataDir(), '.env')), ...readEnvFile(join(process.cwd(), '.env')), ...process.env };
  if (missingRealCoreKeys(env).length) return fallbackCore(options.resourcesDir, true);

  let settings = defaultSettings(options);
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
  let alertBus: import('../runtime/types').Bus | undefined;
  const injectionScreen = createInjectionScreen((source, reason) => alertBus?.emit({
    type: 'wolf.alert', agentId: 'wolf', taskId: source.taskId, source: source.name, reason,
  }));
  const standIns = new StandInSpecialists(clock);
  let sharedApprovals: Approvals | undefined;
  const runner: SpecialistRunner = standIns;
  const documentsRoot = options.documentsRoot ?? join(homedir(), 'Documents');
  const safe = { allowedRoots: settings.allowedFolders, documentsRoot };
  const index = new FileIndex(safe);
  const documents = new BackboardDocuments({ apiKey: env.BACKBOARD_API_KEY! });
  const googleStore = options.safeStorage ? new SafeStorageTokenStore(options.safeStorage) : undefined;
  const googleAuth = env.GOOGLE_CLIENT_ID && googleStore && options.openExternal ? new GoogleAuthService({
    clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET, store: googleStore,
    fetch, openExternal: options.openExternal, clock,
    onEmailChange: email => { settings = { ...settings, googleEmail: email }; options.onSettingsChanged?.(settings); },
  }) : undefined;
  const googleHttp = googleAuth ? new GoogleHttp({
    getAccessToken: () => googleAuth.getAccessToken(), refreshAccessToken: () => googleAuth.forceRefreshAccessToken(),
  }) : undefined;
  const google: GoogleApi | undefined = googleHttp ? {
    gmail: new GmailClient(googleHttp), calendar: new CalendarClient(googleHttp),
    drive: new DriveClient(googleHttp), docs: new DocsClient(googleHttp), sheets: new SheetsClient(googleHttp),
    whoAmI: async () => settings.googleEmail ?? '',
  } : undefined;
  const fakeCalendar = new FakeCalendar(clock);
  const liveCalendar = new GoogleCalendarSource(() => settings.googleEmail ? google : undefined, injectionScreen, () => clock.now());
  const registry = new PixelRegistry();
  const styleStore = new StyleStore(memory, memory);
  const gate = ({ bus }: { bus: import('../runtime/types').Bus }) => new StubWardenGate(bus);
  const approvals = ({ bus, clock, jobs }: import('../chipCore').ArchieContext) =>
    sharedApprovals ??= createApprovals(bus, clock, jobs);
  const core = createChipCore({
    llm, runner, calendar: { listEvents: (from, to) => settings.googleEmail ? liveCalendar.listEvents(from, to) : fakeCalendar.listEvents(from, to) }, settings: () => settings,
    chipAssistantId: assistantIds.chipmunk!, clock, eventSink,
    nudgeStore: new TigerNudgeStore(db), history: new TigerHistoryStore(db, () => clock.now()),
    ...(assistantIds.beaver && options.fsShell ? { archie: {
      llm, assistantId: assistantIds.beaver, gate, approvals, safe, index,
      journal: new LocalFileOpsJournal(join(adeDataDir(), 'archie-file-ops.jsonl')),
      shell: options.fsShell, documents, screen: injectionScreen,
    } } : {}),
    ...(assistantIds.eagle && options.openExternal ? { eagle: {
      llm, assistantId: assistantIds.eagle, openExternal: options.openExternal, documentsRoot,
      gate, approvals, screen: injectionScreen,
    } } : {}),
  });
  alertBus = core.bus;
  standIns.connect(core.bus);
  // Pixel joins ChipCore's registry; Archie and Scout registered during core construction.
  if (google && assistantIds.workspace) {
    try {
      const services = { google: () => settings.googleEmail ? google : undefined, screen: injectionScreen,
        getStyle: () => styleStore.get(), documents,
        tempFiles: { withTempFile: <T>(name: string, contents: Uint8Array, use: (absolutePath: string) => Promise<T>) => withTempFile(contents, name, use) },
        isOwnedDoc: async (id: string) => Boolean(await registry.get('doc', id)),
        registerDoc: async (doc: { id: string; title: string }) => { await registry.record({ kind: 'doc', id: doc.id, title: doc.title, createdAt: clock.now(), state: 'waiting' }); },
      };
      const definition = createPixelAgent([
        ...createGmailTools({ google, screen: injectionScreen, registry, documents,
          safePath: path => safePath(path, safe), ensureConnected: () => !!settings.googleEmail }),
        ...createCalendarTools(services), ...createDriveTools(services), ...createDocsTools(services),
        ...createSheetsTools(services), ...createStyleTool(services),
      ]);
      const pixelApprovals = approvals({ bus: core.bus, clock, jobs: core.jobs });
      const pixelRuntime = createAgentRuntime({ bus: core.bus, llm, jobs: core.jobs,
        gate: gate({ bus: core.bus }), approvals: pixelApprovals,
        settings: () => settings, agents: [{ definition, assistantId: assistantIds.workspace }], screen: injectionScreen });
      core.registerSpecialist('workspace', pixelRuntime);
    } catch (error) { console.error('[core] Pixel construction failed; using stand-in', error); }
  }
  void index.build().catch(error => console.error('[core] Archie file index unavailable', error));
  if (googleAuth) void googleAuth.authorizedFetch('https://gmail.googleapis.com/gmail/v1/users/me/profile')
    .then(response => response.ok ? response.json() : undefined)
    .then(profile => { if (profile && typeof profile.emailAddress === 'string') {
      settings = { ...settings, googleEmail: profile.emailAddress }; options.onSettingsChanged?.(settings);
    } })
    .catch(() => undefined);

  return {
    subscribe: cb => core.bus.subscribe(cb),
    start: () => {
      // createChipCore starts presence before the shell subscribes; repeat the snapshot once both windows are ready.
      for (const agentId of ids) {
        core.bus.emit({ type: 'agent.presence', agentId, presence: core.presence.get(agentId), reason: 'startup' });
      }
    },
    sendMessage: async (text, source) => {
      if (handleStandInSendPost(core.bus, text, source)) return;
      core.orchestrator.submitUserMessage(text, { source });
    },
    sendVoice: async (audio, mime) => {
      if (!settings.voiceEnabled || !voice) return;
      const { text, cues } = await voice.transcribe(audio, mime);
      if (text && !handleStandInSendPost(core.bus, text, 'voice')) core.orchestrator.submitUserMessage(text, { source: 'voice', voiceCues: cues });
    },
    speak: async (agentId, text, mood) => {
      if (!settings.voiceEnabled || !voice || !voiceIds[agentId]) return silent();
      try { return (await voice.speak(agentId, text, mood)).audio; }
      catch { return silent(); }
    },
    resolveApproval: async (callId, approved) => {
      sharedApprovals?.resolve(callId, approved);
    },
    wakeAgent: agentId => core.presence.wake(agentId, 'user'),
    sleepAgent: async agentId => { core.presence.dock(agentId); },
    setDoNotDisturb: async on => { core.setDoNotDisturb(on); },
    demoFireNudge: async () => { core.nudges.fireNextNow(); },
    getSettings: async () => structuredClone(settings),
    setSettings: async patch => {
      settings = { ...settings, ...patch, models: { ...settings.models, ...patch.models },
        installed: { ...settings.installed, ...patch.installed },
        timers: { ...settings.timers, ...patch.timers }, nudges: { ...settings.nudges, ...patch.nudges } };
      if (patch.demoMode !== undefined) settings.timers = patch.demoMode
        ? { ...settings.timers, sleepAfterSec: 30, dockAfterSec: 60 }
        : { ...settings.timers, sleepAfterSec: 180, dockAfterSec: 600 };
      safe.allowedRoots = settings.allowedFolders;
      if (patch.demoMode !== undefined || patch.timers) for (const id of ids) core.presence.touch(id);
      if (patch.allowedFolders) void index.build().catch(error => console.error('[core] Archie file index unavailable', error));
    },
    connectGoogle: async () => { if (!googleAuth) throw new Error('Google OAuth needs GOOGLE_CLIENT_ID and Electron safeStorage.'); return googleAuth.connect(); },
    disconnectGoogle: async () => { await googleAuth?.disconnect(); settings = { ...settings, googleEmail: undefined }; },
    learnEmailStyle: async () => {
      if (!google || !settings.googleEmail || !assistantIds.workspace) throw new Error('Connect Google and configure Pixel first.');
      const result = await learnEmailStyle({ gmail: google.gmail, llm, assistantId: assistantIds.workspace, store: styleStore });
      return { sampled: result.sampled };
    },
    getTimeline: (from, to) => queries.timeline(from, to),
    getTaskEvents: taskId => queries.taskEvents(taskId),
    getMemories: async agentId => (await memory.list(agentId)).map(row => ({ id: row.id, memory: row.content })),
    searchMemories: async (agentId, q) => (await memory.search(agentId, q)).map(row => ({ id: row.id, memory: row.content })),
    updateMemory: (agentId, id, text) => memory.update(agentId, id, text),
    deleteMemory: (agentId, id) => memory.remove(agentId, id),
    getPulse: () => queries.pulse(),
    getWardenAudit: limit => queries.wardenAudit(limit),
    dispose: () => { sharedApprovals?.dispose(); index.stopWatching(); void core.dispose().then(() => eventSink.dispose()).then(() => db.end()); },
  };
}
