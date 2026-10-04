import { describe, expect, it } from 'vitest';
import { makeRig, mood, SEC, say, tools } from './helpers';

const moodLine = (e: { agentId: string; mood: string; cause: string }): string => `${e.agentId}:${e.mood}:${e.cause}`;

describe('C15 "ok thanks, that\'s better" right after C14', () => {
  it('relief: Chip relieved, Warden proud, everyone else happy', async () => {
    const t = makeRig({
      script: [
        tools(mood('angry', 0.9, 'all caps')), say('Easy', 'I hear you. Looking now.'),
        tools(mood('calm', 0.3, 'thanks, relaxed')), say('Phew', "Glad that's better!"),
      ],
    });
    await t.user('THIS IS SO ANNOYING NOTHING WORKS');
    await t.advance(3 * SEC);                                           // contagion has finished; decay (20 s) has not
    expect(t.chip.mood.getUserMood()).toBe('angry');
    const before = t.ofType('agent.mood').length;

    await t.user("ok thanks, that's better");
    const second = t.ofType('user.mood')[1]!;
    expect(second).toMatchObject({ mood: 'calm' });
    await t.advance(3 * SEC);

    const relief = t.ofType('agent.mood').slice(before);
    expect(relief.map(moodLine)).toEqual([
      'chipmunk:relieved:user',
      'workspace:happy:chipmunk',
      'wolf:proud:chipmunk',
      'beaver:happy:chipmunk',
      'eagle:happy:chipmunk',
      'ants:happy:chipmunk',
    ]);
    expect(relief[0]!.ts).toBe(second.ts);                              // Chip relaxes immediately
    expect(relief.slice(1).map((e) => e.ts - second.ts)).toEqual([400, 650, 900, 1150, 1400]);
    expect(t.chip.mood.getUserMood()).toBe('calm');
    expect(t.chipSays('chip').at(-1)).toMatchObject({ bubble: 'Phew' });
  });
});
