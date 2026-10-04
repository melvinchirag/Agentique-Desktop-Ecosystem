import { describe, expect, it, vi } from 'vitest';
import { EventBus } from '../src/main/bus/eventBus';
import { FakeClock } from '../src/main/runtime/clock';
import { createApprovals } from '../src/main/core/approvals';
import type { JobScheduler } from '../src/main/runtime/types';

describe('live approval cards', () => {
  it('pauses the job until a card is resolved and emits the outcome', async () => {
    const clock = new FakeClock(0);
    const bus = new EventBus({ clock });
    const pauseClock = vi.fn(); const resumeClock = vi.fn();
    const approvals = createApprovals(bus, clock, { pauseClock, resumeClock } as unknown as JobScheduler);
    const controller = new AbortController();
    const result = approvals.request({ callId: 'c1', jobId: 'j1', taskId: 't1', agentId: 'beaver',
      title: 'Move files?', preview: 'Two files', signal: controller.signal });
    expect(pauseClock).toHaveBeenCalledWith('j1');
    expect(bus.recent().at(-1)).toMatchObject({ type: 'approval.request', callId: 'c1', preview: 'Two files' });
    approvals.resolve('c1', true);
    expect(await result).toEqual({ approved: true, how: 'user' });
    expect(resumeClock).toHaveBeenCalledWith('j1');
    expect(bus.recent().at(-1)).toMatchObject({ type: 'approval.resolve', callId: 'c1', approved: true });
  });

  it('declines after five minutes or job cancellation', async () => {
    const clock = new FakeClock(0); const bus = new EventBus({ clock });
    const approvals = createApprovals(bus, clock, { pauseClock: vi.fn(), resumeClock: vi.fn() } as unknown as JobScheduler);
    const controller = new AbortController();
    const first = approvals.request({ callId: 'c1', jobId: 'j1', taskId: 't1', agentId: 'workspace',
      title: 'Calendar write?', preview: 'Tomorrow', signal: controller.signal });
    clock.advance(300_000);
    expect(await first).toEqual({ approved: false, how: 'timeout' });
    const second = approvals.request({ callId: 'c2', jobId: 'j2', taskId: 't2', agentId: 'beaver',
      title: 'Move?', preview: 'One file', signal: controller.signal });
    controller.abort();
    expect(await second).toEqual({ approved: false, how: 'cancelled' });
    expect(approvals.pending()).toEqual([]);
  });
});
