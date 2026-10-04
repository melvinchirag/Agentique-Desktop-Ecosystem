import { describe, expect, it } from 'vitest';
import { makeRig, mood, say, tools } from './helpers';

describe('C16 unclear "send that to them"', () => {
  it('Chip asks one short question; no job starts and nothing is acked', async () => {
    const t = makeRig({ script: [tools(mood('calm', 0.3, 'plain words')), say('Which one?', 'Send what, and to whom?')] });
    await t.user('send that to them');

    const spoken = t.chipSays();
    expect(spoken).toEqual([expect.objectContaining({ priority: 'chip', bubble: 'Which one?', text: 'Send what, and to whom?' })]);
    expect(spoken[0]!.text.endsWith('?')).toBe(true);
    expect(spoken[0]!.text.split(/[.!?]\s/)).toHaveLength(1);           // one sentence
    expect(t.chip.jobs.list()).toHaveLength(0);
    expect(t.specialists.runs).toHaveLength(0);
    expect(t.ofType('job.update')).toHaveLength(0);
    expect(t.chipSays('ack')).toHaveLength(0);
    expect(t.ofType('agent.status').filter((e) => e.agentId === 'chipmunk').at(-1)).toMatchObject({ status: 'idle' });
  });
});
