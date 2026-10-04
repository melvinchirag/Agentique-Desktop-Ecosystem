import { describe, expect, it, vi } from 'vitest';
import { createAntsAgent, createAntsTools, createSwarmPlanStore, parsePlan, parsePlanSummary } from './index';
import { createChipCore } from '../../chipCore';
import { FakeClock } from '../../runtime/clock';
import { FakeCalendar } from '../../testing/fakeCalendar';
import { completed, FakeLlm, requiresAction, toolCall } from '../../testing/fakeLlm';
import { fakeResult } from '../../testing/fakeSpecialists';
import { makeTestSettings } from '../../testing/settings';
import { StubWardenGate } from '../../testing/stubWarden';
import type { Approvals } from '../../runtime/types';

const steps = [
  { n: 1, agent: 'beaver', task: 'Read the desktop notes and summarize the findings.' },
  { n: 2, agent: 'eagle', task: 'Find three credible sources for the findings.' },
  { n: 3, agent: 'workspace', task: 'Draft a Google Doc report using the notes and sources.' },
];
const summary = `BUBBLE: Plan ready\nSAY: Plan assembled! Three steps.\nSUMMARY: \`\`\`json\n${JSON.stringify({ steps })}\n\`\`\``;
const approvals = (): Approvals => ({ request: async () => ({ approved: false, how: 'cancelled' }),
  resolve() {}, cancelForJobs() {}, pending: () => [], dispose() {} });

describe('Swarm plan', () => {
  it('accepts a numbered JSON block for Chip and rejects malformed plans', () => {
    expect(parsePlanSummary(`\`\`\`json\n${JSON.stringify({ steps })}\n\`\`\``)).toEqual(steps);
    expect(parsePlan({ steps: steps.slice(0, 1) })).toBeNull();
    expect(parsePlan({ steps: [...steps, ...steps, ...steps].slice(0, 7) })).toBeNull();
    expect(parsePlan({ steps: [{ ...steps[0], n: 2 }, steps[1]] })).toBeNull();
    expect(parsePlan({ steps: [{ ...steps[0], agent: 'wolf' }, steps[1]] })).toBeNull();
    expect(parsePlan({ steps: [{ ...steps[0], task: ' ' }, steps[1]] })).toBeNull();
    expect(parsePlanSummary('no JSON')).toBeNull();
  });

  it('saves valid plans in memory, appends through an optional writer, and emits day_plan', async () => {
    const append = vi.fn(async () => {});
    const store = createSwarmPlanStore(append);
    const emit = vi.fn();
    const save = createAntsTools(store)[0]!;
    expect(save.risk).toBe('draft');
    expect(await save.execute({ goal: '  Write a report  ', steps }, { taskId: 'task-1', emit } as never))
      .toMatchObject({ saved: true });
    expect(store.latest()).toEqual({ goal: 'Write a report', steps });
    expect(append).toHaveBeenCalledWith({ goal: 'Write a report', steps });
    expect(emit).toHaveBeenCalledWith(expect.objectContaining({ kind: 'day_plan', agentId: 'ants' }));
    expect(await save.execute({ goal: 'Bad', steps: [{ ...steps[0], agent: 'ants' }, steps[1]] },
      { taskId: 'task-2', emit } as never)).toEqual({ error: 'INVALID_PLAN' });
    expect(append).toHaveBeenCalledTimes(1);
  });

  it('registers one tool with four rounds and routes a live ants job', async () => {
    const definition = createAntsAgent(createSwarmPlanStore());
    expect([definition.id, definition.maxToolRounds, definition.tools.map(t => t.name)])
      .toEqual(['ants', 4, ['plan_save']]);
    const clock = new FakeClock();
    const antsLlm = new FakeLlm([requiresAction([toolCall('plan_save', { goal: 'Write a report', steps })]), completed(summary)]);
    const fallback = vi.fn(async () => fakeResult('ants'));
    const core = createChipCore({ llm: new FakeLlm(), runner: { run: fallback }, calendar: new FakeCalendar(clock),
      settings: makeTestSettings, chipAssistantId: 'chip', clock, startNudges: false,
      ants: { llm: antsLlm, assistantId: 'swarm', gate: ({ bus }) => new StubWardenGate(bus), approvals },
    });
    const job = core.jobs.submit({ agent: 'ants', task: 'Plan a report', title: 'Plan: report',
      requestedBy: 'chipmunk', kind: 'normal', parentTaskId: 'task-1' });
    const result = await core.jobs.waitFor(job.jobId!);
    expect(result.ok).toBe(true);
    expect(parsePlanSummary(result.summary)).toEqual(steps);
    expect(result.artifacts).toEqual([{ kind: 'day_plan', title: 'Plan: Write a report' }]);
    expect(core.ants?.plans.latest()?.steps).toEqual(steps);
    expect(fallback).not.toHaveBeenCalled();
    expect(antsLlm.calls[0]).toMatchObject({ kind: 'send', params: { assistantId: 'swarm', memory: 'Auto', webSearch: 'off' } });
    const send = antsLlm.calls[0];
    if (send?.kind !== 'send') throw new Error('Expected send');
    expect(send.params.tools?.map(t => t.function.name)).toEqual(['plan_save']);
    await core.dispose();
  });
});
