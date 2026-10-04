import { describe, expect, it } from 'vitest';
import { RESULT_BATCH_MS } from '../../src/main/runtime/orchestrator';
import { fakeResult, toolCall } from '../../src/main/testing';
import { delegate, makeRig, mood, outputOf, SEC, say, silent, tools } from './helpers';

const PLAN = '1. Archie [beaver]: read the notes on the desktop. 2. Scout [eagle]: find 3 sources. 3. Pixel [workspace]: draft the report.';

describe('C19 "Turn the notes on my desktop into a report with 3 sources"', () => {
  it('Swarm plans first; then Chip delegates steps 1-3 (Archie, Scout, Pixel) with plan_step, each handoff via ants', async () => {
    const t = makeRig({
      script: [
        tools(mood('calm', 0.4, 'a big ask'), delegate('ants', 'Plan: notes into report', { task: 'Plan how to turn the notes on the desktop into a report with 3 sources.' })),
        silent(),
        // Swarm's plan arrives: Chip hands out each step itself, in order.
        (call) => {
          const content = call.kind === 'send' ? call.params.content : '';
          expect(content).toContain('Swarm [ants]');
          expect(content).toContain(PLAN);
          return tools(
            toolCall('delegate', { agent: 'beaver', title: 'Read desktop notes', task: 'Read the notes on the desktop and list the key points.', plan_step: 1 }),
            toolCall('delegate', { agent: 'eagle', title: 'Find three sources', task: 'Find 3 reliable sources on the notes topic, with links.', plan_step: 2 }),
            toolCall('delegate', { agent: 'workspace', title: 'Draft the report', task: 'Draft the report from the key points and the 3 sources.', plan_step: 3 }),
          );
        },
        say('Plan rolling 🐜', 'Swarm made the plan. Archie, Scout, and Pixel are on it.'),
        say('Report ready', 'The report draft is ready, with three sources.'),
      ],
    });
    t.specialists.setBehavior('ants', () => fakeResult('ants', { say: 'Plan is ready!', bubble: 'Plan 🐜', summary: PLAN }));

    await t.user('turn the notes on my desktop into a report with 3 sources');
    const taskId = t.ofType('user.message')[0]!.taskId;

    // First delegate: Swarm, "Plan: …", no ant (it isn't a plan step).
    const first = t.chip.jobs.list();
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({ agent: 'ants', requestedBy: 'chipmunk', parentTaskId: taskId });
    expect(first[0]!.title.startsWith('Plan:')).toBe(true);
    expect(first[0]!.planStep).toBeUndefined();
    expect(t.handoffs()).toEqual([expect.objectContaining({ to: 'ants', task: 'Plan: notes into report' })]);
    expect(t.handoffs()[0]!.via).toBeUndefined();
    expect(t.chipSays('ack')).toEqual([expect.objectContaining({ text: 'Swarm, assemble!' })]);

    await t.advance(3 * SEC + RESULT_BATCH_MS);                         // Swarm done → result turn → Chip delegates 1, 2, 3

    const delegateRound = t.toolOutputs().at(-1);
    expect([0, 1, 2].map((i) => outputOf(delegateRound, i).status)).toEqual(['started', 'started', 'started']);
    const handoffs = t.handoffs().slice(1);
    expect(handoffs.map((e) => [e.to, e.task, e.via])).toEqual([
      ['beaver', 'Read desktop notes', 'ants'],
      ['eagle', 'Find three sources', 'ants'],
      ['workspace', 'Draft the report', 'ants'],
    ]);
    expect(handoffs.every((e) => e.agentId === 'chipmunk' && e.taskId === taskId)).toBe(true);
    const steps = t.chip.jobs.list().filter((j) => j.planStep !== undefined).sort((a, b) => a.planStep! - b.planStep!);
    expect(steps.map((j) => [j.planStep, j.agent])).toEqual([[1, 'beaver'], [2, 'eagle'], [3, 'workspace']]);
    expect(t.chipSays('ack')).toHaveLength(1);                          // acks are only for the first delegate of a user turn
    expect(t.chipSays('chip').map((e) => e.text)).toEqual(['Swarm made the plan. Archie, Scout, and Pixel are on it.']);

    await t.advance(3 * SEC + RESULT_BATCH_MS);                         // the three steps finish together
    expect(t.jobUpdates().filter((e) => e.state === 'done').map((e) => e.to).sort()).toEqual(['ants', 'beaver', 'eagle', 'workspace']);
    expect(t.chipSays('chip').at(-1)).toMatchObject({ text: 'The report draft is ready, with three sources.', taskId });
  });
});
