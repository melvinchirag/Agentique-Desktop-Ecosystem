import { ipcMain } from 'electron';
import { AGENTS } from '../../shared/config';
import { SHELL_IPC } from './contracts';
import type { AgentId } from '../../shared/agents';
import type { DisplayLayout, HubTab, OverlayController, Rect } from './contracts';

export const isBoolean = (value: unknown): value is boolean => typeof value === 'boolean';
export const isRects = (value: unknown): value is Rect[] => Array.isArray(value) && value.length <= 64 && value.every(rect =>
  rect !== null && typeof rect === 'object' &&
  ['x', 'y', 'width', 'height'].every(key => Number.isFinite(rect[key])) &&
  rect.width >= 0 && rect.height >= 0,
);
export const isAgentId = (value: unknown): value is AgentId => typeof value === 'string' && Object.hasOwn(AGENTS, value);
const HUB_TABS: readonly HubTab[] = ['chat', 'timeline', 'memories', 'pulse', 'audit', 'settings', 'marketplace'];
export const isHubTab = (value: unknown): value is HubTab => HUB_TABS.includes(value as HubTab);
export const isTaskId = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 200;

interface Sender { sender: { send(channel: string, ...args: unknown[]): void } }
export const registerShellIpc = (opts: {
  overlay: { webContents: Sender['sender'] };
  hub: { webContents: Sender['sender'] };
  controller: OverlayController;
  layout(): DisplayLayout;
  focusChat(): void;
  focusHub(): void;
  blurHub(): void;
  setHubCollapsed(on: boolean): void;
  openAssetLab(): void;
  setAnimalsHidden(on: boolean): void;
}): (() => void) => {
  const listeners: [string, (event: Sender, ...args: any[]) => void][] = [];
  const on = (channel: string, fn: (event: Sender, ...args: any[]) => void) => {
    ipcMain.on(channel, fn);
    listeners.push([channel, fn]);
  };
  const overlay = (event: Sender) => event.sender === opts.overlay.webContents;
  const hub = (event: Sender) => event.sender === opts.hub.webContents;
  ipcMain.handle(SHELL_IPC.getLayout, () => opts.layout());
  on(SHELL_IPC.setInteractive, (event, value: unknown) => {
    if (overlay(event) && isBoolean(value)) opts.controller.setInteractive(value);
  });
  on(SHELL_IPC.publishHitShapes, (event, value: unknown) => {
    if (overlay(event) && isRects(value)) opts.controller.setHitShapes(value);
  });
  on(SHELL_IPC.hubFocusChat, () => opts.focusChat());
  on(SHELL_IPC.openHubTab, (_event, tab: unknown, agentId?: unknown) => {
    if (!isHubTab(tab) || (agentId !== undefined && !isAgentId(agentId))) return;
    opts.hub.webContents.send(SHELL_IPC.openHubTab, tab, agentId);
    opts.focusHub();
  });
  on(SHELL_IPC.inspectAgent, (_event, agentId: unknown) => {
    if (isAgentId(agentId)) opts.overlay.webContents.send(SHELL_IPC.inspectAgent, agentId);
  });
  on(SHELL_IPC.openAssetLab, () => opts.openAssetLab());
  on(SHELL_IPC.hideAnimals, (_event, value: unknown) => {
    if (!isBoolean(value)) return;
    opts.setAnimalsHidden(value);
  });
  on(SHELL_IPC.blurHub, event => { if (hub(event)) opts.blurHub(); });
  on(SHELL_IPC.setHubCollapsed, (event, value: unknown) => {
    if (hub(event) && isBoolean(value)) opts.setHubCollapsed(value);
  });
  on(SHELL_IPC.replayTask, (event, taskId: unknown) => {
    if (hub(event) && isTaskId(taskId)) opts.overlay.webContents.send(SHELL_IPC.replayTask, taskId);
  });
  return () => {
    ipcMain.removeHandler(SHELL_IPC.getLayout);
    for (const [channel, fn] of listeners) ipcMain.removeListener(channel, fn);
  };
};
