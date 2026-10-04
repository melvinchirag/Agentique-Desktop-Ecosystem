import type { BiomeEvent } from '../../shared/events';
import type { AdeApi, AdeSettings } from '../../shared/ipc';
import { AGENTS } from '../../shared/config';
import type { AgentId, ModelChoice } from '../../shared/agents';
import type { BiomeEventInput } from '../../main/runtime/types';
import type { AdeShellApi, DisplayLayout } from '../../main/shell/contracts';

export interface MockCalls { calls: { method: string; args: unknown[] }[] }

export function makeEvent(input: BiomeEventInput, ts = Date.now()): BiomeEvent {
  return { ...input, id: crypto.randomUUID(), ts, sessionId: 'mock-session' } as BiomeEvent;
}

export function createMockAdeApi(overrides: Partial<AdeApi> = {}): AdeApi & MockCalls & { emit(e: BiomeEvent): void } {
  const calls: MockCalls['calls'] = [];
  const listeners = new Set<(e: BiomeEvent) => void>();
  const record = <T>(method: string, value: T) => (...args: unknown[]): Promise<T> => {
    calls.push({ method, args });
    return Promise.resolve(value);
  };
  const ids = Object.keys(AGENTS) as AgentId[];
  const settings: AdeSettings = {
    models: Object.fromEntries(ids.map(id => [id, { llm_provider: 'openai', model_name: 'gpt-4o' }])) as Record<AgentId, ModelChoice>,
    installed: Object.fromEntries(ids.map(id => [id, AGENTS[id].tier === 'core'])) as Record<AgentId, boolean>,
    voiceEnabled: true, allowedFolders: [], biome: 'forest', demoMode: false,
    timers: { sleepAfterSec: 180, dockAfterSec: 600, moodDecaySec: 20 },
    nudges: { enabled: true, quietStart: '23:00', quietEnd: '08:00', maxPerHour: 3 },
  };
  const api: AdeApi = {
    sendMessage: record('sendMessage', undefined),
    sendVoice: record('sendVoice', undefined),
    speak: record('speak', new ArrayBuffer(0)),
    resolveApproval: record('resolveApproval', undefined),
    wakeAgent: record('wakeAgent', undefined),
    sleepAgent: record('sleepAgent', undefined),
    setDoNotDisturb: record('setDoNotDisturb', undefined),
    demoFireNudge: record('demoFireNudge', undefined),
    getSettings: record('getSettings', settings),
    setSettings: record('setSettings', undefined),
    connectGoogle: record('connectGoogle', { email: '' }),
    learnEmailStyle: record('learnEmailStyle', { sampled: 0 }),
    getTimeline: record('getTimeline', [] as BiomeEvent[]),
    getTaskEvents: record('getTaskEvents', [] as BiomeEvent[]),
    getMemories: record('getMemories', [] as { id: string; memory: string }[]),
    searchMemories: record('searchMemories', [] as { id: string; memory: string }[]),
    updateMemory: record('updateMemory', undefined),
    deleteMemory: record('deleteMemory', undefined),
    getPulse: record('getPulse', {}),
    getWardenAudit: record('getWardenAudit', [] as object[]),
    onEvent: cb => { calls.push({ method: 'onEvent', args: [cb] }); listeners.add(cb); return () => listeners.delete(cb); },
    ...overrides,
  };
  return { ...api, calls, emit: e => { for (const cb of [...listeners]) cb(e); } };
}

export function createMockShellApi(overrides: Partial<AdeShellApi> = {}): AdeShellApi & MockCalls & {
  emitLayout(layout: DisplayLayout): void;
  emitDemoHotkey(key: Parameters<Parameters<AdeShellApi['onDemoHotkey']>[0]>[0]): void;
  emitFocusChat(): void;
  emitOpenHubTab(...args: Parameters<Parameters<AdeShellApi['onOpenHubTab']>[0]>): void;
  emitInspectAgent(...args: Parameters<Parameters<AdeShellApi['onInspectAgent']>[0]>): void;
  emitSettings(settings: Parameters<Parameters<AdeShellApi['onSettingsChanged']>[0]>[0]): void;
  emitReplayTask(taskId: string): void;
} {
  const calls: MockCalls['calls'] = [];
  const listeners = {
    layout: new Set<Parameters<AdeShellApi['onLayoutChanged']>[0]>(),
    hotkey: new Set<Parameters<AdeShellApi['onDemoHotkey']>[0]>(),
    focus: new Set<Parameters<AdeShellApi['onFocusChat']>[0]>(),
    tab: new Set<Parameters<AdeShellApi['onOpenHubTab']>[0]>(),
    inspect: new Set<Parameters<AdeShellApi['onInspectAgent']>[0]>(),
    settings: new Set<Parameters<AdeShellApi['onSettingsChanged']>[0]>(),
    replay: new Set<Parameters<AdeShellApi['onReplayTask']>[0]>(),
  };
  const layout: DisplayLayout = {
    workArea: { x: 0, y: 0, width: 1536, height: 816 },
    displayBounds: { x: 0, y: 0, width: 1536, height: 864 },
    scaleFactor: 1.25,
    hubBounds: { x: 1160, y: 16, width: 360, height: 560 },
    hubCollapsed: false, animalsHidden: false, demoMode: false, devMode: true,
  };
  const send = (method: string) => (...args: unknown[]) => { calls.push({ method, args }); };
  const listen = <T extends (...args: never[]) => void>(method: string, set: Set<T>, cb: T) => {
    calls.push({ method, args: [cb] }); set.add(cb); return () => set.delete(cb);
  };
  const api: AdeShellApi = {
    setInteractive: send('setInteractive'), publishHitShapes: send('publishHitShapes'),
    getLayout: () => { calls.push({ method: 'getLayout', args: [] }); return Promise.resolve(layout); },
    onLayoutChanged: cb => listen('onLayoutChanged', listeners.layout, cb),
    hubFocusChat: send('hubFocusChat'), openHubTab: send('openHubTab'), inspectAgent: send('inspectAgent'),
    openAssetLab: send('openAssetLab'), hideAnimals: send('hideAnimals'),
    onDemoHotkey: cb => listen('onDemoHotkey', listeners.hotkey, cb),
    blurHub: send('blurHub'), setHubCollapsed: send('setHubCollapsed'),
    onFocusChat: cb => listen('onFocusChat', listeners.focus, cb),
    onOpenHubTab: cb => listen('onOpenHubTab', listeners.tab, cb),
    onInspectAgent: cb => listen('onInspectAgent', listeners.inspect, cb),
    onSettingsChanged: cb => listen('onSettingsChanged', listeners.settings, cb),
    replayTask: send('replayTask'),
    onReplayTask: cb => listen('onReplayTask', listeners.replay, cb),
    ...overrides,
  };
  return {
    ...api, calls,
    emitLayout: value => listeners.layout.forEach(cb => cb(value)),
    emitDemoHotkey: key => listeners.hotkey.forEach(cb => cb(key)),
    emitFocusChat: () => listeners.focus.forEach(cb => cb()),
    emitOpenHubTab: (tab, id) => listeners.tab.forEach(cb => cb(tab, id)),
    emitInspectAgent: id => listeners.inspect.forEach(cb => cb(id)),
    emitSettings: value => listeners.settings.forEach(cb => cb(value)),
    emitReplayTask: id => listeners.replay.forEach(cb => cb(id)),
  };
}
