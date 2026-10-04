import { describe, expect, it } from 'vitest';
import { RESULT_BATCH_MS } from '../../src/main/runtime/orchestrator';
import { fakeResult, toolCall } from '../../src/main/testing';
import { delegate, makeRig, mood, SEC, say, silent, tools } from './helpers';

describe('C6 "Research internships, then draft an email to Melvin"', () => {
  it('Scout job with next_step → result turn → Pixel job with the result → draft → "you hit send"', async () => {
    const list = 'Acme (remote), Globex (NYC), Initech (Detroit).';
    const t = makeRig({
      script: [
        tools(mood('excited', 0.6), delegate('eagle', 'Internship research', { next_step: 'draft email to Melvin with the list' })),
        silent(),
        // Scout's result turn: Chip reads next_step and delegates to Pixel with the list written into the task.
        (call) => {
          const content = call.kind === 'send' ? call.params.content : '';
          expect(content).toContain('next_step: draft email to Melvin with the list');
          const found = /summary: (.*)/.exec(content)?.[1] ?? '';
          return tools(toolCall('delegate', { agent: 'workspace', title: 'Email to Melvin', task: `Draft an email to Melvin listing: ${found}` }));
        },
        say('Drafting ✍️', "Scout found three. Pixel's drafting the email to Melvin."),
        say('Draft ready', "It's in your Drafts. You hit send."),
      ],
    });
    t.specialists.setBehavior('eagle', () => fakeResult('eagle', { say: 'Found three!', bubble: 'Internships', summary: list }));
    t.specialists.setBehavior('workspace', () => fakeResult('workspace', {
      say: 'Draft is ready!', bubble: 'Draft 📬', summary: "Draft to Melvin saved in Gmail Drafts. It's in your Drafts, you hit send.",
    }));

    await t.user('research internships, then draft an email to Melvin');
    const taskId = t.ofType('user.message')[0]!.taskId;
    expect(t.chip.jobs.list()[0]).toMatchObject({ agent: 'eagle', nextStep: 'draft email to Melvin with the list' });

    await t.advance(3 * SEC + RESULT_BATCH_MS);                        // Scout done → result turn → Pixel delegated
    const pixelRun = t.specialists.runs.find((r) => r.agentId === 'workspace')!;
    expect(pixelRun.task).toContain(list);                              // the result travelled inside the task
    expect(pixelRun.ctx.taskId).toBe(taskId);                           // same user request
    expect(t.chipSays('ack')).toHaveLength(1);                          // only the first delegate of a user turn is acked
    expect(t.handoffs().map((e) => e.to)).toEqual(['eagle', 'workspace']);
    expect(t.chipSays('chip').map((e) => e.text)).toEqual(["Scout found three. Pixel's drafting the email to Melvin."]);

    await t.advance(3 * SEC + RESULT_BATCH_MS);                        // Pixel done → final result turn
    expect(t.reports('workspace')[0]).toMatchObject({ text: 'Draft is ready!' });
    const last = t.chipSays('chip').at(-1)!;
    expect(last.text).toContain('You hit send');
    expect(last.taskId).toBe(taskId);
    expect(t.sends().at(-1)!.content).toContain('Draft to Melvin saved in Gmail Drafts');
  });
});
