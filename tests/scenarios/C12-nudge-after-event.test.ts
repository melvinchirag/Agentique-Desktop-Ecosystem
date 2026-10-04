import { describe, expect, it } from 'vitest';
import { flushPromises } from '../../src/main/runtime/clock';
import { completed } from '../../src/main/testing';
import { makeRig, mood, MIN, RoutedLlm, SEC, say, tools } from './helpers';

describe('C12 the fake calendar "Midterm" ends; fast-forward 1 h', () => {
  it('the planner schedules an "after" nudge; it fires 1 h after the midterm ends and Chip asks how it went', async () => {
    // The fake calendar's "CS 280 Midterm" ends 5 min after the rig starts (12:00 → 12:05). The planner picks 13:05.
    const askAt = new Date(2026, 9, 4, 13, 5);
    const plannerLlm = new RoutedLlm(() => completed(JSON.stringify({
      nudges: [{ eventId: 'ev-midterm', kind: 'after', askAt: askAt.toISOString(), question: 'How did the midterm go?', about: 'CS 280 midterm' }],
    })));
    // Chip's own brain is separate from the planner's. It answers nudge turns by content (the daily rule nudge also fires at 12:00:30).
    const chipLlm = new RoutedLlm((call) => {
      if (call.kind === 'toolOutputs') return say('Great!', 'Glad it went well!');
      const c = call.params.content;
      if (c.startsWith('[nudge]')) return /midterm/i.test(c) ? say('Midterm 📝', 'How did the midterm go?') : say('Morning ☀️', 'Morning! Want the rundown for today?');
      return tools(mood('happy', 0.5, 'good news'));
    });
    const t = makeRig({ llm: chipLlm, plannerLlm, startNudges: true });

    await t.advance(30 * SEC);                                          // planner has run; rule nudges exist
    const planned = t.chip.nudgeStore.all.find((n) => n.source === 'planner')!;
    expect(planned).toMatchObject({ kind: 'after', eventId: 'ev-midterm', about: 'CS 280 midterm', state: 'pending' });
    expect(planned.askAt.getTime()).toBe(askAt.getTime());
    expect(chipLlm.calls.every((c) => c.kind !== 'send' || !/midterm/i.test(c.params.content))).toBe(true);   // the planner never used Chip's client

    await t.advance(65 * MIN - 1 * SEC - 30 * SEC);                     // 13:04:59
    expect(t.ofType('nudge.fire').some((e) => e.kind === 'after')).toBe(false);
    expect(t.chipSays('chip').some((e) => /midterm/i.test(e.text))).toBe(false);

    await t.advance(1 * SEC + 30 * SEC);                                // 13:05:30: the 30 s check at 13:05:00 fired it
    const fired = t.ofType('nudge.fire').find((e) => e.kind === 'after')!;
    expect(fired).toMatchObject({ agentId: 'chipmunk', about: 'CS 280 midterm', nudgeId: planned.id });
    expect(new Date(fired.ts).getHours() * 60 + new Date(fired.ts).getMinutes()).toBe(13 * 60 + 5);

    const spoken = t.chipSays('chip').find((e) => /midterm/i.test(e.text))!;
    expect(spoken).toMatchObject({ text: 'How did the midterm go?', bubble: 'Midterm 📝', priority: 'chip' });
    expect(spoken.taskId).toBeTruthy();                                 // a nudge turn gets its own task
    const nudgeTurn = t.sends().find((s) => s.content.startsWith('[nudge]') && /midterm/i.test(s.content))!;
    expect(nudgeTurn.content).toContain('kind: after');
    expect(nudgeTurn.memory).toBe('Readonly');

    // The user's reply answers it.
    await t.user('it went great, thanks!');
    await flushPromises();
    expect(t.chip.nudgeStore.all.find((n) => n.id === planned.id)?.state).toBe('answered');
    expect(t.chipSays('chip').at(-1)!.text).toBe('Glad it went well!');
  });
});
