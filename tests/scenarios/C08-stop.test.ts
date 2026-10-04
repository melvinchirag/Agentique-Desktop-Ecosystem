import { describe, expect, it } from 'vitest';
import { delegate, makeRig, mood, SEC, say, silent, tools } from './helpers';

describe('C8 "Stop Scout"', () => {
  it("cancels only Scout's jobs, with no AI call; Pixel carries on", async () => {
    const t = makeRig({
      delayMs: { eagle: 60 * SEC, workspace: 5 * SEC },
      script: [
        tools(mood('calm'), delegate('eagle', 'Pizza near campus'), delegate('workspace', "Today's inbox")),
        silent(),
        say('5 emails 📬', 'Five emails today.'),                      // Pixel's result turn
      ],
    });

    await t.user('find pizza near campus and check my email');
    const callsBefore = t.llmCalls().length;
    await t.advance(2 * SEC);

    await t.user('Stop Scout');
    expect(t.llmCalls()).toHaveLength(callsBefore);                    // handled before any Backboard call
    expect(t.chipSays('chip')).toEqual([expect.objectContaining({ text: 'Stopped Scout!', bubble: 'Stopped' })]);

    const cancelled = t.jobUpdates().filter((e) => e.state === 'cancelled');
    expect(cancelled.map((e) => e.to)).toEqual(['eagle']);
    const eagleRun = t.specialists.runs.find((r) => r.agentId === 'eagle')!;
    expect(eagleRun.ctx.signal.aborted).toBe(true);                     // Scout was told to stop
    expect(t.chip.jobs.list().find((j) => j.agent === 'workspace')).toMatchObject({ state: 'running' });

    await t.advance(5 * SEC);                                           // Pixel finishes + result turn
    expect(t.jobUpdates('workspace').map((e) => e.state)).toEqual(['running', 'done']);
    expect(t.reports('eagle')).toHaveLength(0);                         // a cancelled job never reports
    expect(t.chipSays('chip').map((e) => e.text)).toEqual(['Stopped Scout!', 'Five emails today.']);
    await t.advance(60 * SEC);
    expect(t.jobUpdates('eagle').map((e) => e.state)).toEqual(['running', 'cancelled']);
  });
});
