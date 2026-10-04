import { describe, expect, it } from 'vitest';
import { makeRig, mood, say, tools } from './helpers';

describe('C1 small talk', () => {
  it('no jobs; one bubble + speech from Chip, after the mood report', async () => {
    const t = makeRig({ script: [tools(mood('happy', 0.6, 'greeting')), say('Hi!', "Hey there! I'm Chip. What are we up to today?")] });
    await t.user('hi chip!');

    expect(t.chip.jobs.list()).toHaveLength(0);
    expect(t.specialists.runs).toHaveLength(0);
    expect(t.ofType('job.update')).toHaveLength(0);
    expect(t.ofType('agent.handoff')).toHaveLength(0);
    expect(t.chipSays('ack')).toHaveLength(0);

    expect(t.chipSays()).toEqual([
      expect.objectContaining({ agentId: 'chipmunk', priority: 'chip', bubble: 'Hi!', text: "Hey there! I'm Chip. What are we up to today?" }),
    ]);

    const seq = t.events()
      .filter((e) => e.type === 'user.message' || e.type === 'user.mood'
        || ((e.type === 'agent.status' || e.type === 'agent.say') && e.agentId === 'chipmunk'))
      .map((e) => (e.type === 'agent.status' ? `status:${e.status}` : e.type === 'agent.say' ? `say:${e.priority}` : e.type));
    expect(seq).toEqual(['user.message', 'status:listening', 'status:thinking', 'user.mood', 'say:chip', 'status:idle']);

    // Everything the turn caused shares one taskId.
    const taskId = t.ofType('user.message')[0]!.taskId;
    expect(taskId).toBeTruthy();
    expect(t.chipSays()[0]!.taskId).toBe(taskId);
    expect(t.ofType('user.mood')[0]).toMatchObject({ mood: 'happy', taskId });
  });
});
