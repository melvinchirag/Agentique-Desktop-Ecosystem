import { describe, expect, it } from 'vitest';
import { HOUR, makeRig, MIN, RoutedLlm, SEC, say } from './helpers';

describe('C13 a nudge due 11:30 PM', () => {
  it('is held through quiet hours (11 PM to 8 AM) and goes out at 8 AM', async () => {
    const chipLlm = new RoutedLlm(() => say('Morning ☀️', 'Morning! Two quick things. Want the rundown, and how did the interview go?'));
    const t = makeRig({ llm: chipLlm, startNudges: true, start: new Date(2026, 9, 4, 23, 10) });
    const hm = (ts: number): string => `${new Date(ts).getHours()}:${String(new Date(ts).getMinutes()).padStart(2, '0')}`;

    t.chip.nudges.schedule({
      kind: 'custom', source: 'chip', about: 'Google interview', question: 'How did the interview go?', askAt: new Date(2026, 9, 4, 23, 30),
    });

    await t.advance(20 * MIN + 5 * MIN);                                // 23:35: due since 23:30, but it's quiet time
    expect(t.ofType('nudge.fire')).toHaveLength(0);
    await t.advance(8 * HOUR + 24 * MIN + 59 * SEC);                    // 07:59:59
    expect(t.ofType('nudge.fire')).toHaveLength(0);
    expect(t.chipSays('chip')).toHaveLength(0);
    expect(t.chip.nudgeStore.all.find((n) => n.about === 'Google interview')).toMatchObject({ state: 'pending' });

    await t.advance(1 * SEC + 30 * SEC);                                // the 30 s check at 08:00:00 sends it
    const fires = t.ofType('nudge.fire');
    expect(fires.length).toBeGreaterThanOrEqual(1);
    expect(fires.map((e) => hm(e.ts))).toEqual(fires.map(() => '8:00'));
    expect(fires.some((e) => e.about === 'Google interview' && e.kind === 'custom')).toBe(true);

    // One batch → one nudge turn for Chip → one spoken message.
    const nudgeTurns = t.sends().filter((s) => s.content.startsWith('[nudge]'));
    expect(nudgeTurns).toHaveLength(1);
    expect(nudgeTurns[0]!.content).toContain('Google interview');
    expect(t.chipSays('chip')).toHaveLength(1);
    expect(hm(t.chipSays('chip')[0]!.ts)).toBe('8:00');
  }, 30_000);

  it('control: the same nudge at 10:30 PM (before quiet hours) goes out right away', async () => {
    const chipLlm = new RoutedLlm(() => say('Quick Q', 'Quick one: how did the interview go?'));
    const t = makeRig({ llm: chipLlm, startNudges: true, start: new Date(2026, 9, 4, 22, 20) });
    t.chip.nudges.schedule({
      kind: 'custom', source: 'chip', about: 'Google interview', question: 'How did the interview go?', askAt: new Date(2026, 9, 4, 22, 30),
    });
    await t.advance(10 * MIN + 30 * SEC);
    expect(t.ofType('nudge.fire').some((e) => e.about === 'Google interview')).toBe(true);
  });
});
