import { describe, expect, it } from 'vitest';
import { fakeResult } from '../../src/main/testing';
import { delegate, makeRig, mood, SEC, say, silent, tools } from './helpers';

describe('C7 Pixel calls ask_teammate(beaver) while Archie is busy with its own job', () => {
  it('the help job runs right away; Pixel ← Archie handoff; the help job has no ask_teammate', async () => {
    const t = makeRig({
      delayMs: { beaver: 5 * SEC, workspace: 1 * SEC },
      script: [
        tools(mood('calm'), delegate('beaver', 'Organize downloads')), silent(),
        tools(mood('calm'), delegate('workspace', 'Email with syllabus')), silent(),
        say('Tidy 🪵', 'Archie organized your downloads.'),           // Archie's own result turn
        say('Sent along', 'Pixel found the syllabus and drafted the email.'),
      ],
    });

    // Archie: what its runtime would offer each kind of job (spec §3, §10.6: help jobs get no ask_teammate).
    const archieRuns: { kind: string; tools: string[] }[] = [];
    t.specialists.setBehavior('beaver', (task, ctx) => {
      archieRuns.push({ kind: ctx.kind, tools: ctx.kind === 'help' ? [] : ['ask_teammate'] });
      return fakeResult('beaver', { summary: `Archie did: ${task}` });
    });
    // Pixel needs a file, so it asks Archie for it.
    let helpSubmit: { status: string; jobId?: string } | undefined;
    t.specialists.setBehavior('workspace', async (_task, ctx) => {
      helpSubmit = t.chip.jobs.submit({
        agent: 'beaver', task: 'Find the syllabus PDF', title: 'Find syllabus', requestedBy: 'workspace', kind: 'help', parentTaskId: ctx.taskId,
      });
      const help = await t.chip.jobs.waitFor(helpSubmit.jobId!);
      return fakeResult('workspace', { summary: `Drafted the email with the syllabus. ${help.summary}` });
    });

    await t.user('organize my downloads');                              // Archie: busy until t = 5 s
    await t.advance(1 * SEC);
    await t.user('email Prof Lee my syllabus');                         // Pixel starts at t = 1 s, asks Archie at t = 2 s
    await t.advance(1 * SEC + 500);                                     // t = 2.5 s: the help job is running, Archie's own job too

    expect(helpSubmit).toMatchObject({ status: 'started' });            // not queued behind Archie's own job
    const archieStates = t.jobUpdates('beaver');
    const help = archieStates.find((e) => e.title === 'Find syllabus')!;
    expect(help).toMatchObject({ state: 'running', requestedBy: 'workspace', agentId: 'workspace' });
    expect(archieStates.some((e) => e.title === 'Find syllabus' && e.state === 'queued')).toBe(false);
    expect(archieStates.find((e) => e.title === 'Organize downloads')!.state).toBe('running');
    expect(t.chip.jobs.list().filter((j) => j.agent === 'beaver' && j.state === 'running').map((j) => j.kind).sort()).toEqual(['help', 'normal']);

    // The animation cue: Pixel → Archie, no ants.
    const handoff = t.handoffs().find((e) => e.task === 'Find syllabus')!;
    expect(handoff).toMatchObject({ agentId: 'workspace', to: 'beaver' });
    expect(handoff.via).toBeUndefined();
    expect(handoff.ts - t.startedAt).toBe(2 * SEC);                     // right when Pixel asked, 3 s before Archie's own job ends

    await t.advance(10 * SEC);

    expect(archieRuns).toEqual([{ kind: 'normal', tools: ['ask_teammate'] }, { kind: 'help', tools: [] }]);
    expect(t.specialists.runs.filter((r) => r.agentId === 'beaver').map((r) => r.ctx.kind)).toEqual(['normal', 'help']);

    // The help result goes back to Pixel (agent.return to the asker), not to Chip.
    const helpReturn = t.ofType('agent.return').find((e) => e.agentId === 'beaver' && e.to === 'workspace');
    expect(helpReturn?.summary).toContain('Find the syllabus PDF');
    const resultTurns = t.sends().filter((s) => s.content.startsWith('[job_results]'));
    expect(resultTurns).toHaveLength(2);                                // Archie's own job and Pixel's, never the help job
    expect(resultTurns.some((s) => s.content.includes('· "Find syllabus"'))).toBe(false);     // no result item for it (the [context] jobs line may list it while it runs)
    expect(t.chipSays('chip').map((e) => e.text)).toEqual(['Archie organized your downloads.', 'Pixel found the syllabus and drafted the email.']);
  });
});
