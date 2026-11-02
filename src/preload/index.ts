import { contextBridge, ipcRenderer } from 'electron';
import { IPC } from '../shared/ipc';
import { SHELL_IPC } from '../main/shell/contracts';
import type { AdeApi } from '../shared/ipc';
import type { AdeShellApi } from '../main/shell/contracts';
import { SETUP_IPC, type SetupApi } from '../main/setup/contracts';

const on = <T extends unknown[]>(channel: string, cb: (...args: T) => void): (() => void) => {
  const listener = (_event: Electron.IpcRendererEvent, ...args: unknown[]) => cb(...args as T);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
};

const api: AdeApi = {
  sendMessage: (text, source) => ipcRenderer.invoke(IPC.sendMessage, text, source),
  sendVoice: (audio, mime) => ipcRenderer.invoke(IPC.sendVoice, audio, mime),
  speak: (agentId, text, mood) => ipcRenderer.invoke(IPC.speak, agentId, text, mood),
  resolveApproval: (callId, approved) => ipcRenderer.invoke(IPC.resolveApproval, callId, approved),
  wakeAgent: agentId => ipcRenderer.invoke(IPC.wakeAgent, agentId),
  sleepAgent: agentId => ipcRenderer.invoke(IPC.sleepAgent, agentId),
  setDoNotDisturb: enabled => ipcRenderer.invoke(IPC.setDoNotDisturb, enabled),
  demoFireNudge: () => ipcRenderer.invoke(IPC.demoFireNudge),
  getSettings: () => ipcRenderer.invoke(IPC.getSettings),
  setSettings: patch => ipcRenderer.invoke(IPC.setSettings, patch),
  connectGoogle: () => ipcRenderer.invoke(IPC.connectGoogle),
  disconnectGoogle: () => ipcRenderer.invoke(IPC.disconnectGoogle),
  learnEmailStyle: () => ipcRenderer.invoke(IPC.learnEmailStyle),
  getTimeline: (fromTs, toTs) => ipcRenderer.invoke(IPC.getTimeline, fromTs, toTs),
  getTaskEvents: taskId => ipcRenderer.invoke(IPC.getTaskEvents, taskId),
  getMemories: agentId => ipcRenderer.invoke(IPC.getMemories, agentId),
  searchMemories: (agentId, query) => ipcRenderer.invoke(IPC.searchMemories, agentId, query),
  updateMemory: (agentId, memoryId, text) => ipcRenderer.invoke(IPC.updateMemory, agentId, memoryId, text),
  deleteMemory: (agentId, memoryId) => ipcRenderer.invoke(IPC.deleteMemory, agentId, memoryId),
  getPulse: () => ipcRenderer.invoke(IPC.getPulse),
  getWardenAudit: limit => ipcRenderer.invoke(IPC.getWardenAudit, limit),
  onEvent: cb => on(IPC.event, cb),
};

const shell: AdeShellApi = {
  setInteractive: enabled => ipcRenderer.send(SHELL_IPC.setInteractive, enabled),
  publishHitShapes: rects => ipcRenderer.send(SHELL_IPC.publishHitShapes, rects),
  getLayout: () => ipcRenderer.invoke(SHELL_IPC.getLayout),
  onLayoutChanged: cb => on(SHELL_IPC.layoutChanged, cb),
  hubFocusChat: () => ipcRenderer.send(SHELL_IPC.hubFocusChat),
  openHubTab: (tab, agentId) => ipcRenderer.send(SHELL_IPC.openHubTab, tab, agentId),
  inspectAgent: agentId => ipcRenderer.send(SHELL_IPC.inspectAgent, agentId),
  openAssetLab: () => ipcRenderer.send(SHELL_IPC.openAssetLab),
  hideAnimals: enabled => ipcRenderer.send(SHELL_IPC.hideAnimals, enabled),
  onDemoHotkey: cb => on(SHELL_IPC.demoHotkey, cb),
  blurHub: () => ipcRenderer.send(SHELL_IPC.blurHub),
  setHubCollapsed: collapsed => ipcRenderer.send(SHELL_IPC.setHubCollapsed, collapsed),
  onFocusChat: cb => on(SHELL_IPC.hubFocusChat, cb),
  onOpenHubTab: cb => on(SHELL_IPC.openHubTab, cb),
  onInspectAgent: cb => on(SHELL_IPC.inspectAgent, cb),
  onSettingsChanged: cb => on(SHELL_IPC.settingsChanged, cb),
  replayTask: taskId => ipcRenderer.send(SHELL_IPC.replayTask, taskId),
  onReplayTask: cb => on(SHELL_IPC.replayTask, cb),
};

contextBridge.exposeInMainWorld('ade', api);
contextBridge.exposeInMainWorld('adeShell', shell);
const setup: SetupApi = {
  status: () => ipcRenderer.invoke(SETUP_IPC.status),
  verify: key => ipcRenderer.invoke(SETUP_IPC.verify, key),
  save: (key, voice) => ipcRenderer.invoke(SETUP_IPC.save, key, voice),
  restart: () => ipcRenderer.send(SETUP_IPC.restart),
  demo: () => ipcRenderer.send(SETUP_IPC.demo),
  open: () => ipcRenderer.send(SETUP_IPC.open),
  onProgress: cb => on(SETUP_IPC.progress, cb),
};
contextBridge.exposeInMainWorld('adeSetup', setup);
