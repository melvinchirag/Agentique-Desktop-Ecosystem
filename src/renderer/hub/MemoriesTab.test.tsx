// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { MemoriesTab } from './MemoriesTab';
import { createHubStore } from '../shell/hubStore';
import { createMockAdeApi } from '../shell/mocks';

afterEach(cleanup);

describe('MemoriesTab', () => {
  it('lists all installed animals with memory, including later installs', async () => {
    const api = createMockAdeApi();
    const settings = await api.getSettings();
    settings.installed.butterfly = true;
    const store = createHubStore({ settings });
    render(<MemoriesTab api={api} store={store} selectedAgentId="chipmunk" onSelectAgent={() => {}} />);
    expect(screen.getByRole('button', { name: 'Select Iris' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Select Warden' })).toBeNull();
  });

  it('shows API errors instead of an empty-memory message', async () => {
    const api = createMockAdeApi({ getMemories: async () => { throw new Error('Backboard unavailable'); } });
    const store = createHubStore({ settings: await api.getSettings() });
    render(<MemoriesTab api={api} store={store} selectedAgentId="chipmunk" onSelectAgent={() => {}} />);
    expect((await screen.findByRole('alert')).textContent).toContain('Backboard unavailable');
    await waitFor(() => expect(screen.queryByText(/No memories found/)).toBeNull());
  });
});
