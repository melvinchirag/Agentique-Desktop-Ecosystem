import { describe, expect, it } from 'vitest';
import { makeRig, mood, SEC, say, tools } from './helpers';

const SHOUT = 'THIS IS SO ANNOYING NOTHING WORKS';
const moodLine = (e: { agentId: string; mood: string; cause: string }): string => `${e.agentId}:${e.mood}:${e.cause}`;

describe('C14 shouting', () => {
  it('Chip is scared at once, the active animals catch it one by one, and everyone is neutral after 20 s', async () => {
    const t = makeRig({ script: [tools(mood('angry', 0.9, 'all caps, frustrated')), say('Easy', "I hear you. We can take this one step at a time.")] });
    await t.user(SHOUT);

    const userMood = t.ofType('user.mood')[0]!;
    expect(userMood).toMatchObject({ mood: 'angry', intensity: 0.9 });
    expect(t.moodsOf('chipmunk')[0]).toMatchObject({ mood: 'scared', cause: 'user', taskId: userMood.taskId });
    expect(t.moodsOf('chipmunk')[0]!.ts).toBe(userMood.ts);             // Chip reacts immediately, before anyone else
    expect(t.ofType('agent.mood')).toHaveLength(1);

    await t.advance(5 * SEC);
    const moods = t.ofType('agent.mood');
    expect(moods.map(moodLine)).toEqual([
      'chipmunk:scared:user',
      'workspace:nervous:chipmunk',                                     // order: Pixel → Warden → Archie → Scout → Swarm
      'wolf:protective:chipmunk',
      'beaver:scared:chipmunk',
      'eagle:nervous:chipmunk',
      'ants:scared:chipmunk',
    ]);
    expect(moods.slice(1).map((e) => e.ts - userMood.ts)).toEqual([400, 650, 900, 1150, 1400]);   // 400 ms, then 250 ms apart
    expect(t.moodsOf('butterfly')).toHaveLength(0);                     // not installed

    // Chip answers calmly and briefly.
    expect(t.chipSays('chip')).toEqual([expect.objectContaining({ bubble: 'Easy' })]);
    expect(t.chipSays('chip')[0]!.text.split(/[.!?]\s/).length).toBeLessThanOrEqual(3);

    // 20 s after the shout everything is neutral again.
    await t.advance(14 * SEC);                                          // t = 19 s
    expect(t.ofType('agent.mood').filter((e) => e.mood === 'neutral')).toHaveLength(0);
    await t.advance(1 * SEC);                                           // t = 20 s
    const neutral = t.ofType('agent.mood').filter((e) => e.mood === 'neutral');
    expect(neutral.map((e) => e.agentId).sort()).toEqual(['ants', 'beaver', 'chipmunk', 'eagle', 'wolf', 'workspace']);
    expect(neutral.every((e) => e.ts - userMood.ts === 20 * SEC)).toBe(true);
  });

  it('sleeping animals are skipped: only the active ones catch the mood', async () => {
    const t = makeRig({ script: [tools(mood('angry', 0.9, 'all caps')), say('Easy', 'I hear you.')] });
    await t.advance(100 * SEC);
    for (const id of ['workspace', 'wolf', 'eagle'] as const) t.chip.presence.touch(id);   // their idle timers restart at t = 100 s
    await t.advance(90 * SEC);                                          // t = 190 s: Archie, Swarm and Chip (180 s) fell asleep
    expect(['beaver', 'ants', 'chipmunk'].map((id) => t.chip.presence.get(id as 'beaver'))).toEqual(['sleeping', 'sleeping', 'sleeping']);
    expect(['workspace', 'wolf', 'eagle'].map((id) => t.chip.presence.get(id as 'wolf'))).toEqual(['active', 'active', 'active']);

    await t.user(SHOUT);                                                // Chip wakes for the user, then reports the mood
    await t.advance(5 * SEC);
    expect(t.ofType('agent.mood').map(moodLine)).toEqual([
      'chipmunk:scared:user',
      'workspace:nervous:chipmunk',
      'wolf:protective:chipmunk',
      'eagle:nervous:chipmunk',
    ]);
    expect(t.moodsOf('beaver')).toHaveLength(0);
    expect(t.moodsOf('ants')).toHaveLength(0);
  });
});
