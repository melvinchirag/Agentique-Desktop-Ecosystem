import { describe, expect, it } from 'vitest';
import { delegate, makeRig, mood, outputOf, SEC, say, silent, tools } from './helpers';

describe('C4 second research while Scout is busy', () => {
  it("queued position 1 → \"Scout's busy. You're next in line!\" → starts after the first finishes", async () => {
    const t = makeRig({
      delayMs: { eagle: 10 * SEC },
      script: [
        tools(mood('calm'), delegate('eagle', 'Pizza near campus')),
        silent(),
        tools(mood('calm'), delegate('eagle', 'Coffee near campus')),
        silent(),
        say('Pizza 🍕', "Tony's is closest."),
        say('Coffee ☕', 'Bean Counter opens at seven.'),
      ],
    });

    await t.user('find pizza near campus');
    await t.advance(2 * SEC);
    await t.user('also find coffee near campus');

    expect(outputOf(t.toolOutputs()[1], 1)).toMatchObject({ status: 'queued', position: 1 });
    expect(t.chipSays('ack').at(-1)).toMatchObject({ text: "Scout's busy. You're next in line!", bubble: 'Next ⏳', priority: 'ack' });
    const queued = t.jobUpdates('eagle').find((e) => e.state === 'queued');
    expect(queued).toMatchObject({ title: 'Coffee near campus', position: 1, requestedBy: 'chipmunk' });
    expect(t.specialists.runs.filter((r) => r.agentId === 'eagle')).toHaveLength(1);   // the second one waits
    expect(t.handoffs().map((e) => e.task)).toEqual(['Pizza near campus']);            // no handoff while queued

    await t.advance(8 * SEC);                                          // first job done at t = 10 s
    const runs = t.specialists.runs.filter((r) => r.agentId === 'eagle');
    expect(runs).toHaveLength(2);
    expect(runs[1]!.startedAt - runs[0]!.startedAt).toBe(10 * SEC);    // started the moment Scout was free
    expect(t.handoffs().map((e) => e.task)).toEqual(['Pizza near campus', 'Coffee near campus']);
    expect(t.jobUpdates('eagle').filter((e) => e.title === 'Coffee near campus').map((e) => e.state)).toEqual(['queued', 'running']);

    await t.advance(10 * SEC);
    expect(t.jobUpdates('eagle').filter((e) => e.title === 'Coffee near campus').map((e) => e.state)).toEqual(['queued', 'running', 'done']);
  });
});
