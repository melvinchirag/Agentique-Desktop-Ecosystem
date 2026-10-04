import type { CoreAdapter } from './contracts';
import type { AdeSettings } from '../../shared/ipc';

export const watchSettings = (adapter: CoreAdapter, onChange: (settings: AdeSettings) => void): CoreAdapter => {
  let last: string | undefined;
  const refresh = async () => {
    const settings = await adapter.getSettings();
    const serialized = JSON.stringify(settings);
    if (serialized !== last) { last = serialized; onChange(settings); }
  };
  void refresh();
  const setSettings: CoreAdapter['setSettings'] = async patch => {
    await adapter.setSettings(patch);
    await refresh();
  };
  return new Proxy(adapter, {
    get(target, key, receiver) {
      if (key === 'setSettings') return setSettings;
      const value: unknown = Reflect.get(target, key, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
};
