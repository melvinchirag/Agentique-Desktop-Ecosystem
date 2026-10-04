import { globalShortcut } from 'electron';
import { SHELL_IPC } from './contracts';
import type { CoreAdapter, DemoHotkey, WebContentsLike } from './contracts';

export const shouldRegister = (demoMode: boolean, devMode: boolean) => demoMode || devMode;

export const createDemoShortcuts = (opts: {
  core(): CoreAdapter | undefined;
  targets(): readonly WebContentsLike[];
  openAssetLab(): void;
  toggleHidden(): void;
}) => {
  const bindings = [
    ['Control+Shift+N', 'nudge', () => { void opts.core()?.demoFireNudge(); }],
    ['Control+Shift+A', 'assetLab', opts.openAssetLab],
    ['Control+Shift+H', 'hideAnimals', opts.toggleHidden],
  ] as const;
  let registered = false;
  const push = (key: DemoHotkey) => {
    for (const target of opts.targets()) if (!target.isDestroyed()) target.send(SHELL_IPC.demoHotkey, key);
  };
  const dispose = () => {
    if (!registered) return;
    for (const [accelerator] of bindings) globalShortcut.unregister(accelerator);
    registered = false;
  };
  return {
    update(demoMode: boolean, devMode: boolean) {
      if (!shouldRegister(demoMode, devMode)) { dispose(); return; }
      if (registered) return;
      for (const [accelerator, key, action] of bindings) {
        globalShortcut.register(accelerator, () => { action(); push(key); });
      }
      registered = true;
    },
    dispose,
  };
};
