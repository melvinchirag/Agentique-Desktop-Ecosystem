import { describe, expect, it } from 'vitest';
import { FOGGY_LINE } from '../../src/main/runtime/orchestrator';
import { makeRig, mood, say, tools } from './helpers';

describe('C17 Backboard down', () => {
  it('Dizzy + the foggy line; the next message works', async () => {
    const t = makeRig({
      script: [new Error('Backboard unreachable'), tools(mood('happy', 0.5, 'friendly')), say('Back!', 'Okay, I hear you now.')],
    });
    await t.user('hello?');
    const first = t.ofType('user.message')[0]!.taskId;

    // Chip goes sad, the status is 'error' (the renderer plays Dizzy), the foggy line is spoken, then idle.
    const turn = t.events().filter((e) => e.taskId === first && e.agentId === 'chipmunk'
      && (e.type === 'agent.mood' || e.type === 'agent.status' || e.type === 'agent.say'));
    expect(turn.map((e) => (e.type === 'agent.status' ? e.status : e.type))).toEqual(['listening', 'thinking', 'agent.mood', 'error', 'agent.say', 'idle']);
    expect(turn[2]).toMatchObject({ mood: 'sad', cause: 'user' });
    expect(t.chipSays()).toEqual([expect.objectContaining({ text: FOGGY_LINE, bubble: 'Foggy 😵', priority: 'chip', taskId: first })]);
    expect(FOGGY_LINE).toBe("My brain's a bit foggy. Say that again?");
    expect(t.ofType('user.mood')).toHaveLength(0);                      // no mood fallback on a failed turn
    expect(t.chip.jobs.list()).toHaveLength(0);

    // The loop survived: the next message gets a real answer.
    await t.user('hello again');
    const second = t.ofType('user.message')[1]!.taskId;
    expect(second).not.toBe(first);
    expect(t.chipSays().at(-1)).toMatchObject({ text: 'Okay, I hear you now.', bubble: 'Back!', taskId: second });
    expect(t.ofType('user.mood')).toEqual([expect.objectContaining({ mood: 'happy', taskId: second })]);
    expect(t.ofType('agent.status').filter((e) => e.taskId === second).some((e) => e.status === 'error')).toBe(false);
  });
});
