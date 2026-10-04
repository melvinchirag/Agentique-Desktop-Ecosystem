import { describe, expect, it } from 'vitest';
import { RESULT_BATCH_MS } from '../../src/main/runtime/orchestrator';
import { fakeResult } from '../../src/main/testing';
import { delegate, makeRig, mood, SEC, say, silent, tools } from './helpers';

describe('C2 "What emails today?"', () => {
  it('ack → Pixel job → Pixel report line → result turn → Chip summary', async () => {
    const t = makeRig({
      script: [
        tools(mood('calm'), delegate('workspace', "Today's inbox")),
        silent(),
        say('5 emails 📬', 'Five emails matter today. Prof Lee moved the quiz to Monday.'),
      ],
    });
    t.specialists.setBehavior('workspace', () => fakeResult('workspace', {
      say: 'Five letters worth reading!', bubble: '5 emails 📬', summary: 'Five emails; Prof Lee moved the quiz to Monday.',
    }));

    await t.user('what emails did I get today?');
    const taskId = t.ofType('user.message')[0]!.taskId;

    // The ack is instant (no AI call); the user turn itself ends silent.
    expect(t.chipSays('ack')).toEqual([expect.objectContaining({ text: "Ooh, mail duty! Pixel, you're up!", bubble: 'Pixel 📬' })]);
    expect(t.chipSays('chip')).toHaveLength(0);
    expect(t.jobUpdates('workspace').map((e) => e.state)).toEqual(['running']);
    expect(t.handoffs()).toEqual([expect.objectContaining({ agentId: 'chipmunk', to: 'workspace', task: "Today's inbox", taskId })]);
    expect(t.handoffs()[0]!.via).toBeUndefined();

    await t.advance(3 * SEC);                                       // Pixel finishes
    expect(t.reports('workspace')).toEqual([
      expect.objectContaining({ text: 'Five letters worth reading!', bubble: '5 emails 📬', priority: 'report', taskId }),
    ]);
    expect(t.chipSays('chip')).toHaveLength(0);                     // Chip waits out the 1.5 s batching window
    await t.advance(RESULT_BATCH_MS);

    const result = t.sends()[1]!;
    expect(result.content.startsWith('[job_results]')).toBe(true);
    expect(result.content).toContain('Pixel [workspace]');
    expect(result.content).toContain('Prof Lee moved the quiz to Monday');
    expect(result.memory).toBe('Readonly');

    expect(t.chipSays('chip')).toEqual([
      expect.objectContaining({ bubble: '5 emails 📬', text: 'Five emails matter today. Prof Lee moved the quiz to Monday.', taskId }),
    ]);

    // The ack's wording depends on what submit() returned, so it follows the job start by a few ms of code,
    // but at the same fake time (§18 shows both at +1.5 s).
    const ack = t.chipSays('ack')[0]!;
    expect(ack.ts).toBe(t.jobUpdates('workspace')[0]!.ts);

    // Order: job running + ack → Pixel's report → agent.return → Chip's summary.
    const order = [
      t.indexOf((e) => e.type === 'job.update' && e.state === 'running'),
      t.indexOf((e) => e.type === 'agent.say' && e.priority === 'ack'),
      t.indexOf((e) => e.type === 'agent.say' && e.agentId === 'workspace'),
      t.indexOf((e) => e.type === 'agent.return' && e.agentId === 'workspace' && e.to === 'chipmunk'),
      t.indexOf((e) => e.type === 'agent.say' && e.agentId === 'chipmunk' && e.priority === 'chip'),
    ];
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(t.jobUpdates('workspace').map((e) => e.state)).toEqual(['running', 'done']);
  });
});
