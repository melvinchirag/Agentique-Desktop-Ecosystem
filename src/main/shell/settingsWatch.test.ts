import { describe, expect, it, vi } from 'vitest';
import { createFakeCore } from '../fake';
import { watchSettings } from './settingsWatch';

describe('watchSettings', () => {
  it('calls through, reports initial and changed full settings, skips equal updates', async () => {
    const base = createFakeCore();
    const set = vi.spyOn(base, 'setSettings');
    const changed = vi.fn();
    const wrapped = watchSettings(base, changed);
    await vi.waitFor(() => expect(changed).toHaveBeenCalledTimes(1));
    await wrapped.setSettings({ demoMode: true });
    expect(set).toHaveBeenCalledWith({ demoMode: true });
    expect(changed).toHaveBeenCalledTimes(2);
    expect(changed.mock.calls[1][0]).toEqual(await base.getSettings());
    await wrapped.setSettings({ demoMode: true });
    expect(changed).toHaveBeenCalledTimes(2);
  });
});
