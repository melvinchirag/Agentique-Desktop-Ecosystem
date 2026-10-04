import { describe, expect, it } from 'vitest';
import { NORMAL_JOB_TIMEOUT_MS } from '../../src/main/runtime/jobs';
import { fakeResult } from '../../src/main/testing';
import { delegate, makeRig, mood, MIN, SEC, say, silent, tools } from './helpers';

type Rig = ReturnType<typeof makeRig>;

/** A Pixel that asks Warden for approval and waits 4 minutes for the user. `pause` = wrap the wait in pauseClock/resumeClock. */
function approvalWaiter(t: Rig, pause: boolean): void {
  t.specialists.setBehavior('workspace', async (_task, ctx) => {
    const callId = 'call-approve-1';
    t.chip.bus.emit({ type: 'approval.request', agentId: 'wolf', taskId: ctx.taskId, callId, title: 'Create event', preview: "Create 'Study group' Sun 3-4 PM (no invites sent)" });
    if (pause) t.chip.jobs.pauseClock(ctx.jobId);
    await new Promise<void>((resolve) => { t.clock.setTimeout(resolve, 4 * MIN); });
    if (pause) t.chip.jobs.resumeClock(ctx.jobId);
    t.chip.bus.emit({ type: 'approval.resolve', agentId: 'wolf', taskId: ctx.taskId, callId, approved: true });
    return fakeResult('workspace', { say: 'Event added!', bubble: 'Added 📅', summary: "Added 'Study group' to Sunday 3 PM." });
  });
}

describe('C11 a job waits on a Warden approval for 4 min', () => {
  it('is NOT timed out while the clock is paused, and continues after the approval', async () => {
    const t = makeRig({
      delayMs: { workspace: 1 * SEC },
      script: [tools(mood('calm'), delegate('workspace', 'Add study group')), silent(), say('Added 📅', 'Study group is on your calendar for Sunday.')],
    });
    approvalWaiter(t, true);
    await t.user('add study group to my calendar on Sunday at 3');

    await t.advance(1 * SEC);                                           // Pixel reaches the approval
    expect(t.ofType('approval.request')).toHaveLength(1);
    await t.advance(NORMAL_JOB_TIMEOUT_MS + 5 * SEC);                   // well past the 3 min limit of working time
    expect(t.chip.jobs.list().find((j) => j.agent === 'workspace')).toMatchObject({ state: 'running' });
    expect(t.jobUpdates('workspace').map((e) => e.state)).toEqual(['running']);

    await t.advance(1 * MIN);                                           // the approval lands at t = 4 min 1 s; then the 1.5 s batching window
    expect(t.ofType('approval.resolve')).toEqual([expect.objectContaining({ approved: true })]);
    expect(t.jobUpdates('workspace').map((e) => e.state)).toEqual(['running', 'done']);
    expect(t.reports('workspace')).toEqual([expect.objectContaining({ text: 'Event added!' })]);
    expect(t.chipSays('chip').map((e) => e.text)).toEqual(['Study group is on your calendar for Sunday.']);
    expect(t.sends().at(-1)!.content).toContain("Added 'Study group' to Sunday 3 PM.");
  });

  it('control: the same wait WITHOUT pausing the clock times out at 3 min', async () => {
    const t = makeRig({
      delayMs: { workspace: 1 * SEC },
      script: [tools(mood('calm'), delegate('workspace', 'Add study group')), silent(), say('Timed out', 'Pixel ran out of time. Want me to try again?')],
    });
    approvalWaiter(t, false);
    await t.user('add study group to my calendar on Sunday at 3');
    await t.advance(NORMAL_JOB_TIMEOUT_MS);
    expect(t.jobUpdates('workspace').map((e) => e.state)).toEqual(['running', 'failed']);
    expect(t.reports('workspace')).toEqual([expect.objectContaining({ bubble: 'Timed out' })]);
  });
});
