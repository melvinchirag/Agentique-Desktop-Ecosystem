import { IPC } from '../../shared/ipc';
import type { RegisterCoreIpc, CoreAdapter } from '../shell/contracts';

export const registerCoreIpc: RegisterCoreIpc = (adapter, { ipc, targets }) => {
  const keys = Object.keys(IPC).filter(key => key !== 'event') as (keyof Omit<CoreAdapter, 'subscribe' | 'start' | 'dispose'>)[];
  for (const key of keys) {
    ipc.handle(IPC[key], (_event, ...args) => (adapter[key] as (...params: unknown[]) => unknown).apply(adapter, args));
  }
  const unsubscribe = adapter.subscribe(event => {
    for (const target of targets()) {
      try {
        if (!target.isDestroyed()) target.send(IPC.event, event);
      } catch (error) {
        console.error('[ipc] event target failed', error);
      }
    }
  });
  return () => {
    for (const key of keys) ipc.removeHandler(IPC[key]);
    unsubscribe();
  };
};
