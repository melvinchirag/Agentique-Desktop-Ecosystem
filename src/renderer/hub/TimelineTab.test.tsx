// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { TimelineTab } from './TimelineTab';
import { createMockAdeApi, createMockShellApi } from '../shell/mocks';

afterEach(cleanup);

describe('TimelineTab', () => {
  it('groups events by task and replays the selected task', async () => {
    const api = createMockAdeApi();
    api.getTimeline = async () => [{ id: 'event-1', ts: Date.now(), sessionId: 'session', taskId: 'task-1', agentId: 'chipmunk', type: 'user.message', text: 'Plan my day', source: 'text' }];
    const shell = createMockShellApi();
    render(<TimelineTab api={api} shell={shell} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Replay task task-1' }));
    await waitFor(() => expect(shell.calls).toContainEqual({ method: 'replayTask', args: ['task-1'] }));
    expect(screen.getByText('Plan my day')).toBeTruthy();
  });
});
