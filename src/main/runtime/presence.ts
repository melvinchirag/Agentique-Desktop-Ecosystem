import type { AgentId, Presence } from '../../shared/agents';
import { AGENTS } from '../../shared/config';
import type { AdeSettings } from '../../shared/ipc';
import type { Bus, Clock, PresenceManager, TimerHandle } from './types';

export interface PresenceDeps { bus: Bus; clock: Clock; settings: () => AdeSettings }

export const WAKE_FROM_DOCK_MS = 1500;

const AGENT_IDS = Object.keys(AGENTS) as AgentId[];

interface AgentTimers {
  sleep?: TimerHandle;
  dock?: TimerHandle;
  returnTimer?: TimerHandle;
  returning?: Promise<void>;
  finishReturn?: () => void;
  busyCount: number;
}

export function createPresenceManager(deps: PresenceDeps): PresenceManager {
  const states = new Map<AgentId, Presence>();
  const timers = new Map<AgentId, AgentTimers>();
  const listeners = new Set<(id: AgentId, p: Presence) => void>();
  let started = false;
  let disposed = false;

  for (const id of AGENT_IDS) {
    states.set(id, deps.settings().installed[id] ? 'sleeping' : 'not_installed');
    timers.set(id, { busyCount: 0 });
  }

  const installed = (id: AgentId): boolean => !disposed && deps.settings().installed[id] === true;
  const timerState = (id: AgentId): AgentTimers => timers.get(id)!;

  function clear(id: AgentId, key: 'sleep' | 'dock'): void {
    const record = timerState(id);
    const handle = record[key];
    if (handle !== undefined) deps.clock.clearTimeout(handle);
    record[key] = undefined;
  }

  function change(id: AgentId, presence: Presence, reason: 'idle_timeout' | 'dock_timeout' | 'user' | 'job' | 'startup'): void {
    if (states.get(id) === presence) return;
    states.set(id, presence);
    deps.bus.emit({ type: 'agent.presence', agentId: id, presence, reason });
    for (const listener of [...listeners]) listener(id, presence);
  }

  function armSleep(id: AgentId): void {
    clear(id, 'sleep');
    if (!installed(id) || states.get(id) !== 'active' || timerState(id).busyCount > 0) return;
    const ms = deps.settings().timers.sleepAfterSec * 1000;
    timerState(id).sleep = deps.clock.setTimeout(() => {
      timerState(id).sleep = undefined;
      if (!installed(id) || states.get(id) !== 'active' || timerState(id).busyCount > 0) return;
      change(id, 'sleeping', 'idle_timeout');
      if (id !== 'chipmunk') armDock(id);
    }, ms);
  }

  function armDock(id: AgentId): void {
    clear(id, 'dock');
    if (id === 'chipmunk' || !installed(id) || states.get(id) !== 'sleeping') return;
    const ms = deps.settings().timers.dockAfterSec * 1000;
    timerState(id).dock = deps.clock.setTimeout(() => {
      timerState(id).dock = undefined;
      if (installed(id) && states.get(id) === 'sleeping') change(id, 'docked', 'dock_timeout');
    }, ms);
  }

  return {
    start(): void {
      if (disposed || started) return;
      started = true;
      for (const id of AGENT_IDS) {
        if (!installed(id)) {
          states.set(id, 'not_installed');
          continue;
        }
        change(id, 'active', 'startup');
        armSleep(id);
      }
    },

    get(id): Presence {
      if (!installed(id)) return 'not_installed';
      return states.get(id) ?? 'not_installed';
    },

    touch(id): void {
      if (!installed(id) || states.get(id) !== 'active') return;
      armSleep(id);
    },

    setBusy(id, busy): void {
      if (!installed(id)) return;
      const record = timerState(id);
      if (busy) {
        record.busyCount += 1;
        clear(id, 'sleep');
        clear(id, 'dock');
        return;
      }
      if (record.busyCount === 0) return;
      record.busyCount -= 1;
      if (record.busyCount === 0 && states.get(id) === 'active') armSleep(id);
    },

    wake(id, reason): Promise<void> {
      if (!installed(id)) return Promise.resolve();
      if (timerState(id).returning) return timerState(id).returning!;
      const state = states.get(id);
      if (state === 'active') {
        if (timerState(id).busyCount === 0) armSleep(id);
        return Promise.resolve();
      }
      clear(id, 'sleep');
      clear(id, 'dock');
      if (state === 'sleeping') {
        change(id, 'active', reason);
        armSleep(id);
        return Promise.resolve();
      }
      if (state === 'docked') {
        const record = timerState(id);
        if (record.returning) return record.returning;
        change(id, 'active', reason);
        let resolveReturn!: () => void;
        const returning = new Promise<void>((resolve) => { resolveReturn = resolve; });
        record.returning = returning;
        record.finishReturn = resolveReturn;
        record.returnTimer = deps.clock.setTimeout(() => {
          if (record.returning === returning) record.returning = undefined;
          record.returnTimer = undefined;
          record.finishReturn = undefined;
          resolveReturn();
          armSleep(id);
        }, WAKE_FROM_DOCK_MS);
        return returning;
      }
      return Promise.resolve();
    },

    onChange(cb): void { listeners.add(cb); },

    dispose(): void {
      if (disposed) return;
      disposed = true;
      for (const id of AGENT_IDS) {
        clear(id, 'sleep');
        clear(id, 'dock');
        if (timerState(id).returnTimer !== undefined) deps.clock.clearTimeout(timerState(id).returnTimer);
        timerState(id).returnTimer = undefined;
        timerState(id).finishReturn?.();
        timerState(id).finishReturn = undefined;
        timerState(id).returning = undefined;
      }
      listeners.clear();
    },
  };
}
