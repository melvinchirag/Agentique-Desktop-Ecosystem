import { randomUUID } from 'node:crypto';
import { loadModelPreferences, saveModelPreferences } from './modelPreferences';
import { dirname, join } from 'node:path';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import type { AgentId } from '../../shared/agents';
import { AGENTS } from '../../shared/config';
import type { BiomeEvent } from '../../shared/events';
import type { AdeSettings } from '../../shared/ipc';
import type { ToolDefinition } from '../../shared/tools';
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
import type { InjectionScreen, SpecialistRunner, VoiceService } from '../runtime/types';
import { assistantIdsFromEnv, readEnvFile, voiceIdsFromEnv, type Env } from '../sponsors/env';
import { BackboardMemoryApi } from '../sponsors/backboardMemory';
import type { CoreAdapter } from '../shell/contracts';
import { createTigerPool, TigerEventSink, adeDataDir } from '../store/tiger';
import { TigerHistoryStore } from '../store/tigerHistory';
import { TigerNudgeStore } from '../store/tigerNudges';
import { TigerQueries } from '../store/tigerQueries';
import { TigerPlanStore } from '../store/tigerPlans';
import { TigerResearchStore } from '../store/tigerResearch';
import { createWardenClassifier } from '../sponsors/wardenClassifier';
import { handleStandInSendPost, StandInSpecialists } from './standInSpecialists';
import { ElevenLabsVoice } from '../voice/elevenlabs';
import { ShippedLines } from '../voice/cache';
import { defaultFolders } from './defaultFolders';

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

export function defaultSettings(options: RealCoreOptions): AdeSettings {
  const model = { llm_provider: 'google', model_name: 'gemini-2.5-flash' };
  const folders = defaultFolders({ desktop: options.desktopRoot, documents: options.documentsRoot, downloads: options.downloadsRoot });
  return {
    models: Object.fromEntries(ids.map(id => [id, { ...model }])) as AdeSettings['models'],
    voiceEnabled: true, allowedFolders: folders.allowed, biome: 'forest', demoMode: !!options.demoTimers,
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
    // Missing live credentials must never expose FakeCore's sample memories as user memories.
    getMemories: async () => [],
    searchMemories: async () => [],
    updateMemory: async () => { throw new Error('Backboard memories are unavailable: missing live credentials'); },
    deleteMemory: async () => { throw new Error('Backboard memories are unavailable: missing live credentials'); },
    sendMessage: async () => { throw new Error('Live services are unavailable: missing credentials'); },
    sendVoice: async () => { throw new Error('Live services are unavailable: missing credentials'); },
    subscribe(cb) {
      listeners.add(cb);
      const off = fake.subscribe(event => { if (event.type !== 'agent.recall') cb(event); });
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
  envPaths?: string[];
  openExternal?: (url: string) => Promise<void>;
  documentsRoot?: string;
  desktopRoot?: string;
  downloadsRoot?: string;
  safeStorage?: SafeStorageLike;
  fsShell?: FsShell;
  demoTimers?: boolean;
  onSettingsChanged?: (settings: AdeSettings) => void;
  exePath?: string;
  packaged?: boolean;
  dataDir?: string;
}

export function loadRealCoreEnv(options: Pick<RealCoreOptions, 'exePath' | 'dataDir' | 'env' | 'envPaths'> = {}): { env: Env; baseDir: string } {
  if (options.env) return { env: options.env, baseDir: process.cwd() };
  const paths = [options.exePath && join(dirname(options.exePath), '.env'), ...(options.envPaths ?? []).slice().reverse(),
    join(options.dataDir ?? adeDataDir(), '.env'), join(process.cwd(), '.env')].filter((path): path is string => !!path);
  const found = [...new Set(paths)].filter(existsSync);
  const env: Env = {};
  let baseDir = found[0] ? dirname(found[0]) : process.cwd();
  // Layer fallback files while keeping executable-side configuration highest priority.
  for (const path of found.slice().reverse()) {
    const values = readEnvFile(path);
    Object.assign(env, values);
    if (values.TIGER_CA_FILE) baseDir = dirname(path);
  }
  return { env: { ...env, ...process.env }, baseDir };
}

export function disconnectedCalendar() { return { listEvents: async () => [] }; }

export function loadPersistedSettings(file: string, defaults: AdeSettings): AdeSettings {
  try {
    const saved = JSON.parse(readFileSync(file, 'utf8')) as Partial<AdeSettings>;
    return { ...defaults, ...saved, models: { ...defaults.models, ...saved.models }, installed: { ...defaults.installed, ...saved.installed }, timers: { ...defaults.timers, ...saved.timers }, nudges: { ...defaults.nudges, ...saved.nudges }, googleEmail: undefined };
  } catch { return defaults; }
}

export function savePersistedSettings(file: string, settings: AdeSettings): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(settings), { mode: 0o600 });
}

/** Main-process adapter. registerCoreIpc forwards this bus to the overlay and Hub. */
export function createRealCore(options: RealCoreOptions = {}): CoreAdapter {
  if (options.demoMode) return fallbackCore(options.resourcesDir, false);
  const { env, baseDir } = loadRealCoreEnv(options);
  if (missingRealCoreKeys(env).length) return fallbackCore(options.resourcesDir, true);

  const modelPreferencesPath = join(options.dataDir ?? adeDataDir(env), 'model-preferences.json');
  const settingsFile = join(options.dataDir ?? adeDataDir(env), 'settings.json');
  let settings = loadPersistedSettings(settingsFile, defaultSettings(options));
  settings.models = { ...settings.models, ...loadModelPreferences(modelPreferencesPath) };
  const persistSettings = () => {
    try { savePersistedSettings(settingsFile, settings); }
    catch (error) { console.warn('[core] Could not save settings', error); }
    options.onSettingsChanged?.(settings);
  };
  const clock = new RealClock();
  const assistantIds = assistantIdsFromEnv(env);
  const llm = new BackboardClient({ apiKey: env.BACKBOARD_API_KEY!, defaultModel: assistantId => {
    const agentId = assistantId && assistantId === env.BB_ASSISTANT_WARDEN_SCREEN
      ? 'wolf' : (assistantId ? ids.find(id => assistantIds[id] === assistantId) : undefined) ?? 'chipmunk';
    return settings.models[agentId];
  } });
  const db = createTigerPool(env, baseDir);
  const plans = new TigerPlanStore(db, () => clock.now());
  const research = new TigerResearchStore(db);
  const queries = new TigerQueries(db);
  const memory = new BackboardMemoryApi(llm, assistantIds);
  const voiceIds = voiceIdsFromEnv(env);
  const shippedLines = new ShippedLines(join(options.resourcesDir ?? (options.packaged ? process.resourcesPath : join(process.cwd(), 'resources')), 'voice-lines'));
  const voice: VoiceService | undefined = env.ELEVENLABS_API_KEY
    ? new ElevenLabsVoice({ apiKey: env.ELEVENLABS_API_KEY, voiceIds, voiceEnabled: () => settings.voiceEnabled,
      shipped: shippedLines })
    : undefined;
  const eventSink = new TigerEventSink({ db });
  let activeScreen: InjectionScreen | undefined;
  const injectionScreen: InjectionScreen = { screen: (text, source) => {
    if (!activeScreen) throw new Error('Warden screen is unavailable');
    return activeScreen.screen(text, source);
  } };
  const standIns = new StandInSpecialists(clock);
  let pixelTools: readonly ToolDefinition[] | undefined;
  const runner: SpecialistRunner = standIns;
  const documentsRoot = defaultFolders({ desktop: options.desktopRoot, documents: options.documentsRoot, downloads: options.downloadsRoot }).documentsRoot;
  const safe = { allowedRoots: settings.allowedFolders, documentsRoot, watch: true };
  const index = new FileIndex(safe);
  const documents = new BackboardDocuments({ apiKey: env.BACKBOARD_API_KEY! });
  const googleStore = options.safeStorage ? new SafeStorageTokenStore(options.safeStorage) : undefined;
  const googleAuth = env.GOOGLE_CLIENT_ID && googleStore && options.openExternal ? new GoogleAuthService({
    clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET, store: googleStore,
    fetch, openExternal: options.openExternal, clock,
    onEmailChange: email => { settings = { ...settings, googleEmail: email }; persistSettings(); },
  }) : undefined;
  const googleHttp = googleAuth ? new GoogleHttp({
    getAccessToken: () => googleAuth.getAccessToken(), refreshAccessToken: () => googleAuth.forceRefreshAccessToken(),
  }) : undefined;
  const google: GoogleApi | undefined = googleHttp ? {
    gmail: new GmailClient(googleHttp), calendar: new CalendarClient(googleHttp),
    drive: new DriveClient(googleHttp), docs: new DocsClient(googleHttp), sheets: new SheetsClient(googleHttp),
    whoAmI: async () => settings.googleEmail ?? '',
  } : undefined;
  const liveCalendar = new GoogleCalendarSource(() => settings.googleEmail ? google : undefined, injectionScreen, () => clock.now());
  const registry = new PixelRegistry();
  const styleStore = new StyleStore(memory, memory);
  let styleLearning: Promise<{ sampled: number }> | undefined;
  const learnStyleOnce = (): Promise<{ sampled: number }> => {
    if (settings.styleLearnedAt) return Promise.resolve({ sampled: 0 });
    if (!google || !settings.googleEmail || !assistantIds.workspace) return Promise.reject(new Error('Connect Google and configure Pixel first.'));
    styleLearning ??= learnEmailStyle({ gmail: google.gmail, llm, assistantId: assistantIds.workspace, store: styleStore })
      .then(result => { settings = { ...settings, styleLearnedAt: clock.now() }; persistSettings(); return { sampled: result.sampled }; })
      .finally(() => { styleLearning = undefined; });
    return styleLearning;
  };
  const core = createChipCore({
    llm, runner, calendar: { listEvents: (from, to) => settings.googleEmail ? liveCalendar.listEvents(from, to) : disconnectedCalendar().listEvents() }, settings: () => settings,
    chipAssistantId: assistantIds.chipmunk!, clock, eventSink,
    nudgeStore: new TigerNudgeStore(db), history: new TigerHistoryStore(db, () => clock.now(), undefined, research), plans,
    warden: { registry: agentId => agentId === 'workspace' ? pixelTools : undefined,
      classifier: env.BB_ASSISTANT_WARDEN_SCREEN
        ? createWardenClassifier({ llm, assistantId: env.BB_ASSISTANT_WARDEN_SCREEN }) : undefined },
    ...(assistantIds.beaver && options.fsShell ? { archie: {
      llm, assistantId: assistantIds.beaver, safe, index,
      journal: new LocalFileOpsJournal(join(adeDataDir(), 'archie-file-ops.jsonl')),
      shell: options.fsShell, documents, screen: injectionScreen,
    } } : {}),
    ...(assistantIds.eagle && options.openExternal ? { eagle: {
      llm, assistantId: assistantIds.eagle, openExternal: options.openExternal, documentsRoot,
      screen: injectionScreen, recordBrief: (title, path) => research.record(title, [], path), recordFindings: (title, summary) => research.record(title, [summary]),
    } } : {}),
    ...(assistantIds.ants ? { ants: {
      llm, assistantId: assistantIds.ants, appendItems: plan => plans.savePlan(plan.goal, plan.steps.map(step => step.task)).then(() => undefined),
    } } : {}),
  });
  activeScreen = core.warden!.screen;
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
      pixelTools = definition.tools;
      const pixelRuntime = createAgentRuntime({ bus: core.bus, llm, jobs: core.jobs,
        gate: core.warden!.gate, approvals: core.warden!.approvals,
        settings: () => settings, agents: [{ definition, assistantId: assistantIds.workspace }], screen: injectionScreen });
      core.registerSpecialist('workspace', pixelRuntime);
    } catch (error) { console.error('[core] Pixel construction failed; using stand-in', error); }
  }
  void index.build().catch(error => console.error('[core] Archie file index unavailable', error));
  if (googleAuth) void googleAuth.authorizedFetch('https://gmail.googleapis.com/gmail/v1/users/me/profile')
    .then(response => response.ok ? response.json() : undefined)
    .then(profile => { if (profile && typeof profile.emailAddress === 'string') {
      settings = { ...settings, googleEmail: profile.emailAddress }; persistSettings();
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
      if (!settings.voiceEnabled) return silent();
      const shipped = shippedLines.get(agentId, text);
      if (shipped) return shipped.audio;
      if (!voice) return silent();
      try { return (await voice.speak(agentId, text, mood)).audio; }
      catch { return silent(); }
    },
    resolveApproval: async (callId, approved) => {
      core.warden?.approvals.resolve(callId, approved);
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
      if (patch.models) saveModelPreferences(modelPreferencesPath, settings.models);
      if (patch.demoMode !== undefined) settings.timers = patch.demoMode
        ? { ...settings.timers, sleepAfterSec: 30, dockAfterSec: 60 }
        : { ...settings.timers, sleepAfterSec: 180, dockAfterSec: 600 };
      safe.allowedRoots = settings.allowedFolders;
      if (patch.demoMode !== undefined || patch.timers) for (const id of ids) core.presence.touch(id);
      if (patch.allowedFolders) void index.build().catch(error => console.error('[core] Archie file index unavailable', error));
      persistSettings();
    },
    connectGoogle: async () => { if (!googleAuth) throw new Error('Google OAuth needs GOOGLE_CLIENT_ID and Electron safeStorage.'); const result = await googleAuth.connect(); settings = { ...settings, googleEmail: result.email }; persistSettings(); void learnStyleOnce().catch(error => console.warn('[core] Pixel style learning failed', error)); return result; },
    disconnectGoogle: async () => { await googleAuth?.disconnect(); settings = { ...settings, googleEmail: undefined }; persistSettings(); },
    learnEmailStyle: learnStyleOnce,
    getTimeline: (from, to) => queries.timeline(from, to),
    getTaskEvents: taskId => queries.taskEvents(taskId),
    getMemories: async agentId => (await memory.list(agentId)).map(row => ({ id: row.id, memory: row.content })),
    searchMemories: async (agentId, q) => (await memory.search(agentId, q)).map(row => ({ id: row.id, memory: row.content })),
    updateMemory: (agentId, id, text) => memory.update(agentId, id, text),
    deleteMemory: (agentId, id) => memory.remove(agentId, id),
    getPulse: () => queries.pulse(),
    getWardenAudit: limit => queries.wardenAudit(limit),
    dispose: () => { index.stopWatching(); void core.dispose().then(() => eventSink.dispose()).then(() => db.end()); },
  };
}
