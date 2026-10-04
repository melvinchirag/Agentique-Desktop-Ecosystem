// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { HubApp } from './HubApp';
import { createHubStore } from '../shell/hubStore';
import { demoSeedState } from '../shell/seed';
import { createMockAdeApi, createMockShellApi } from '../shell/mocks';
import type { AgentId } from '../../shared/agents';

describe('HubApp (Lane L5)', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('ade.onboarded', 'true');
  });

  afterEach(() => {
    cleanup();
  });

  it('Rows render from the seed', () => {
    const store = createHubStore(demoSeedState());
    const api = createMockAdeApi();
    const shell = createMockShellApi();

    render(<HubApp store={store} api={api} shell={shell} />);

    // Check that core agents from seed are rendered in status rows
    expect(screen.getByTestId('agent-row-chipmunk')).toBeTruthy();
    expect(screen.getByTestId('agent-row-workspace')).toBeTruthy();
    expect(screen.getByTestId('agent-row-wolf')).toBeTruthy();
    expect(screen.getByTestId('agent-row-beaver')).toBeTruthy();
    expect(screen.getByTestId('agent-row-eagle')).toBeTruthy();
    expect(screen.getByTestId('agent-row-ants')).toBeTruthy();

    // Not-installed agents (butterfly, nightingale) should be hidden
    expect(screen.queryByTestId('agent-row-butterfly')).toBeNull();
    expect(screen.queryByTestId('agent-row-nightingale')).toBeNull();

    // Verify job title and presence from seed
    expect(screen.getByText('Email digest')).toBeTruthy();
    expect(screen.getByText('Pizza near me')).toBeTruthy();
  });

  it('row click → inspectAgent', () => {
    const store = createHubStore(demoSeedState());
    const api = createMockAdeApi();
    const shell = createMockShellApi();

    render(<HubApp store={store} api={api} shell={shell} />);

    const workspaceRow = screen.getByTestId('agent-row-workspace');
    fireEvent.click(workspaceRow);

    expect(shell.calls).toContainEqual({
      method: 'inspectAgent',
      args: ['workspace'],
    });
  });

  it('Enter sends + blurs', async () => {
    const store = createHubStore(demoSeedState());
    const api = createMockAdeApi();
    const shell = createMockShellApi();

    render(<HubApp store={store} api={api} shell={shell} />);

    const input = screen.getByLabelText('Message') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'Schedule meeting with team' } });

    const form = input.closest('form')!;
    fireEvent.submit(form);

    await waitFor(() => {
      expect(api.calls).toContainEqual({
        method: 'sendMessage',
        args: ['Schedule meeting with team', 'text'],
      });
      expect(shell.calls).toContainEqual({
        method: 'blurHub',
        args: [],
      });
    });

    expect(input.value).toBe('');
  });

  it('Esc blurs', () => {
    const store = createHubStore(demoSeedState());
    const api = createMockAdeApi();
    const shell = createMockShellApi();

    render(<HubApp store={store} api={api} shell={shell} />);

    fireEvent.keyDown(window, { key: 'Escape' });

    expect(shell.calls).toContainEqual({
      method: 'blurHub',
      args: [],
    });
  });

  it('DND toggle calls the api', async () => {
    const store = createHubStore(demoSeedState());
    const api = createMockAdeApi();
    const shell = createMockShellApi();

    render(<HubApp store={store} api={api} shell={shell} />);

    const dndButton = screen.getByLabelText('Toggle Do Not Disturb');
    fireEvent.click(dndButton);

    expect(api.calls).toContainEqual({
      method: 'setDoNotDisturb',
      args: [true],
    });

    expect(store.getState().dnd).toBe(true);
  });

  it('Agents ▾ wakes a docked animal', async () => {
    const seed = demoSeedState();
    // Dock beaver
    if (seed.agents) {
      seed.agents.beaver.presence = 'docked';
    }
    const store = createHubStore(seed);
    const api = createMockAdeApi();
    const shell = createMockShellApi();

    render(<HubApp store={store} api={api} shell={shell} />);

    // Open Agents dropdown
    const dropdownBtn = screen.getByLabelText('Agents dropdown');
    fireEvent.click(dropdownBtn);

    // Click Wake Archie
    const wakeArchieBtn = screen.getByText('Wake Archie');
    fireEvent.click(wakeArchieBtn);

    expect(api.calls).toContainEqual({
      method: 'wakeAgent',
      args: ['beaver'],
    });
  });

  it('Memories delete calls deleteMemory', async () => {
    const store = createHubStore(demoSeedState());
    const api = createMockAdeApi({
      getMemories: () =>
        Promise.resolve([
          { id: 'mem-99', memory: 'Prefers concise morning digests' },
        ]),
    });
    const shell = createMockShellApi();

    render(<HubApp store={store} api={api} shell={shell} />);

    // Switch to Memories tab
    const memoriesTabBtn = screen.getByRole('tab', { name: 'Memories' });
    fireEvent.click(memoriesTabBtn);

    // Wait for memory to load
    await waitFor(() => {
      expect(screen.getByText('Prefers concise morning digests')).toBeTruthy();
    });

    // Click delete
    const deleteBtn = screen.getByLabelText('Delete memory');
    fireEvent.click(deleteBtn);

    expect(api.calls).toContainEqual({
      method: 'deleteMemory',
      args: ['chipmunk', 'mem-99'],
    });
  });

  it('Audit Replay calls replayTask', async () => {
    const store = createHubStore(demoSeedState());
    const api = createMockAdeApi({
      getWardenAudit: () =>
        Promise.resolve([
          {
            ts: Date.now(),
            taskId: 'task-abc-123',
            agentId: 'beaver' as AgentId,
            tool: 'fs_delete',
            verdict: 'ask' as const,
            rule: 'no_unconfirmed_delete',
            reason: 'Deleting important project file',
          },
        ]),
    });
    const shell = createMockShellApi();

    render(<HubApp store={store} api={api} shell={shell} />);

    // Switch to Audit tab
    const auditTabBtn = screen.getByRole('tab', { name: 'Audit' });
    fireEvent.click(auditTabBtn);

    // Wait for audit row with Replay button
    await waitFor(() => {
      expect(screen.getByText('fs_delete')).toBeTruthy();
    });

    const replayBtn = screen.getByLabelText('Replay task task-abc-123');
    fireEvent.click(replayBtn);

    expect(shell.calls).toContainEqual({
      method: 'replayTask',
      args: ['task-abc-123'],
    });
  });

  it('Pulse renders with an empty object without crashing', async () => {
    const store = createHubStore(demoSeedState());
    const api = createMockAdeApi({
      getPulse: () => Promise.resolve({}),
    });
    const shell = createMockShellApi();

    render(<HubApp store={store} api={api} shell={shell} />);

    // Switch to Pulse tab
    const pulseTabBtn = screen.getByRole('tab', { name: 'Pulse' });
    fireEvent.click(pulseTabBtn);

    await waitFor(() => {
      expect(screen.getByLabelText('Biome Pulse statistics')).toBeTruthy();
    });

    // Check empty state fallbacks render safely
    expect(screen.getByText('No mood records yet this week.')).toBeTruthy();
    expect(screen.getByText('No agent jobs recorded yet.')).toBeTruthy();
    expect(screen.getByTestId('warden-blocks-stat').textContent).toContain('0');
    expect(screen.getByTestId('warden-asks-stat').textContent).toContain('0');
  });

  it('onboarding shows once', async () => {
    localStorage.clear(); // not onboarded
    const store = createHubStore(demoSeedState());
    const api = createMockAdeApi();
    const shell = createMockShellApi();

    const { unmount } = render(<HubApp store={store} api={api} shell={shell} />);

    // Onboarding should be visible
    expect(screen.getByLabelText('Onboarding setup')).toBeTruthy();

    // Click finish button
    const finishBtn = screen.getByLabelText('Finish onboarding');
    fireEvent.click(finishBtn);

    // Onboarding is dismissed
    await waitFor(() => {
      expect(screen.queryByLabelText('Onboarding setup')).toBeNull();
    });
    expect(localStorage.getItem('ade.onboarded')).toBe('true');

    unmount();

    // Re-render: should not show onboarding now
    render(<HubApp store={store} api={api} shell={shell} />);
    expect(screen.queryByLabelText('Onboarding setup')).toBeNull();
  });
});
