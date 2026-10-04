import { describe, expect, it } from 'vitest';
import { delegate, makeRig, mood, outputOf, SEC, silent, tools } from './helpers';

describe('C5 same pizza request twice', () => {
  it("duplicate → \"Scout's already on it!\" and no second job", async () => {
    const t = makeRig({
      delayMs: { eagle: 30 * SEC },
      script: [
        tools(mood('calm'), delegate('eagle', 'Pizza near campus')),
        silent(),
        tools(mood('calm'), delegate('eagle', 'pizza near campus!')),     // same title once lowercased and de-punctuated
        silent(),
      ],
    });

    await t.user('find pizza near campus');
    await t.advance(2 * SEC);
    await t.user('find pizza near campus');

    expect(outputOf(t.toolOutputs()[1], 1)).toMatchObject({ status: 'duplicate' });
    expect(t.chipSays('ack').at(-1)).toMatchObject({ text: "Scout's already on it!", bubble: 'On it 👍', priority: 'ack' });
    expect(t.specialists.runs.filter((r) => r.agentId === 'eagle')).toHaveLength(1);
    expect(t.chip.jobs.list().filter((j) => j.agent === 'eagle')).toHaveLength(1);
    expect(t.jobUpdates('eagle').map((e) => e.state)).toEqual(['running']);
  });
});
