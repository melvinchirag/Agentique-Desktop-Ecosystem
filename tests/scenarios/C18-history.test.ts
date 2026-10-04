import { describe, expect, it } from 'vitest';
import { fakeResult, toolCall } from '../../src/main/testing';
import { delegate, makeRig, MIN, mood, outputOf, SEC, say, silent, tools } from './helpers';

interface TaskRow { at: string; asked: string; answered: string | null }

describe('C18 "What did you do for me today?"', () => {
  it('biome_history(recent_tasks) → Chip recaps the day from the rows', async () => {
    let rows: TaskRow[] = [];
    const t = makeRig({
      script: [
        tools(mood('happy', 0.5, 'greeting')), say('Hi!', 'Hey there!'),
        tools(mood('calm'), delegate('workspace', "Today's inbox")), silent(),
        say('Inbox 📬', 'Five emails, nothing urgent.'),                // result turn
        tools(mood('calm'), toolCall('biome_history', { kind: 'recent_tasks', since_hours: 24 }, 'hist-1')),
        (call) => {
          const out = outputOf(call, 1) as { rows: TaskRow[] };     // call 0 is report_user_mood
          rows = out.rows;
          const email = rows.find((r) => r.asked.includes('email'));
          return say('Recap', `We said hi, then Pixel checked your email. ${email?.answered ?? 'No answer yet.'}`);
        },
      ],
    });
    t.specialists.setBehavior('workspace', () => fakeResult('workspace', { summary: 'Five emails; nothing urgent.' }));

    await t.user('hi chip!');
    await t.user('check my email');
    await t.advance(3 * SEC + 1500);
    await t.advance(2 * MIN);                                           // some time passes; still "today"
    await t.user('What did you do for me today?');

    // The tool was asked for the right thing and came back with this session's tasks, newest first.
    const call = t.llmCalls().find((c) => c.kind === 'send' && c.params.content.includes('What did you do'));
    expect(call).toBeDefined();
    expect(rows.map((r) => r.asked)).toEqual(['What did you do for me today?', 'check my email', 'hi chip!']);
    expect(rows.find((r) => r.asked === 'hi chip!')).toMatchObject({ answered: 'Hey there!' });
    expect(rows.find((r) => r.asked === 'check my email')).toMatchObject({ answered: 'Five emails, nothing urgent.' });
    expect(Object.keys(rows[0]!).sort()).toEqual(['answered', 'asked', 'at']);   // titles and short text only, nothing else

    expect(t.chipSays('chip').at(-1)).toMatchObject({
      bubble: 'Recap', text: 'We said hi, then Pixel checked your email. Five emails, nothing urgent.', priority: 'chip',
    });
    expect(t.chip.jobs.list().filter((j) => j.state === 'running' || j.state === 'queued')).toHaveLength(0);   // a recap starts no job
  });
});
