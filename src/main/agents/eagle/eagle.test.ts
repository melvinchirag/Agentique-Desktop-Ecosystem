import { describe, expect, it, vi } from 'vitest';
import { createEagleAgent } from './index';
import { briefPath, createEagleTools, safeWebUrl } from './tools';
import { parseSpecialistOutput } from '../../runtime/specialistOutput';
import { createChipCore } from '../../chipCore';
import { FakeClock } from '../../runtime/clock';
import { RESULT_BATCH_MS } from '../../runtime/orchestrator';
import { FakeCalendar } from '../../testing/fakeCalendar';
import { completed, FakeLlm, requiresAction, toolCall } from '../../testing/fakeLlm';
import { fakeResult } from '../../testing/fakeSpecialists';
import { makeTestSettings } from '../../testing/settings';
import { StubWardenGate } from '../../testing/stubWarden';
import type { Approvals } from '../../runtime/types';

const date = new Date('2026-10-04T12:00:00Z');
const approvals = (): Approvals => ({ request: async () => ({ approved: false, how: 'cancelled' }),
  resolve() {}, cancelForJobs() {}, pending: () => [], dispose() {} });

describe('Scout tools', () => {
  it('accepts only HTTP(S) pages and rejects downloads and credentials', async () => {
    const openExternal = vi.fn(async () => {});
    const open = createEagleTools({ openExternal, documentsRoot: 'C:/Users/test/Documents', now: () => date })[0]!;
    for (const url of ['file:///etc/passwd', 'javascript:alert(1)', 'data:text/plain,x', 'https://site.test/a.zip',
      'https://site.test/a%2Eexe', 'https://user:pass@site.test/', '//site.test/']) {
      expect(safeWebUrl(url)).toBeNull();
      expect(await open.execute({ url }, {} as never)).toEqual({ error: 'INVALID_URL' });
    }
    expect(open.inspect?.({ url: 'https://site.test/a' }).urls).toEqual(['https://site.test/a']);
    expect(await open.execute({ url: 'https://site.test/a' }, {} as never)).toEqual({ opened: 'https://site.test/a' });
    expect(openExternal).toHaveBeenCalledTimes(1);
  });

  it('keeps a hostile title inside ADE Research and emits the brief artifact', async () => {
    const root = 'C:/Users/test/Documents';
    const target = briefPath(root, '../../CON.txt: \\escape', date)!;
    expect(target.replaceAll('\\', '/')).toBe('C:/Users/test/Documents/ADE Research/con-txt-escape-2026-10-04.md');
    const mkdir = vi.fn(async () => undefined);
    const writeFile = vi.fn(async () => undefined);
    const emit = vi.fn();
    const save = createEagleTools({ openExternal: async () => {}, documentsRoot: root,
      fs: { mkdir: mkdir as never, writeFile: writeFile as never }, now: () => date })[1]!;
    expect(save.inspect?.({ title: '../../CON.txt: \\escape' }).writesPaths).toEqual([target]);
    expect(await save.execute({ title: '../../CON.txt: \\escape', markdown: '# Research' },
      { taskId: 'task-1', emit } as never)).toEqual({ path: target });
    expect(writeFile).toHaveBeenCalledWith(target, '# Research', { encoding: 'utf8', flag: 'wx' });
    expect(emit).toHaveBeenCalledWith(expect.objectContaining({ kind: 'research_brief', agentId: 'eagle' }));
  });

  it('declares the Backboard search configuration and parses its final result', () => {
    const agent = createEagleAgent({ openExternal: async () => {}, documentsRoot: 'C:/Documents' });
    expect({ id: agent.id, rounds: agent.maxToolRounds, search: agent.webSearch,
      tools: agent.tools.map(tool => [tool.name, tool.risk]) }).toEqual({
      id: 'eagle', rounds: 6, search: true, tools: [['web_open', 'read'], ['web_save_brief', 'draft']],
    });
    const parsed = parseSpecialistOutput('BUBBLE: Sources found\nSAY: Found three solid sources!\nSUMMARY: - One https://one.test\n- Two https://two.test\n- Three https://three.test', 'Scout');
    expect(parsed.say).toBe('Found three solid sources!');
    expect(parsed.summary).toContain('https://three.test');
  });
});

describe('Scout registration', () => {
  it('routes a delegated eagle job through the real AgentRuntime', async () => {
    const clock = new FakeClock();
    const eagleLlm = new FakeLlm([completed('BUBBLE: Sources found\nSAY: Found three solid sources!\nSUMMARY: - One https://one.test\n- Two https://two.test\n- Three https://three.test')]);
    const fallback = vi.fn(async () => fakeResult('eagle'));
    const settings = makeTestSettings();
    const core = createChipCore({ llm: new FakeLlm(), runner: { run: fallback }, calendar: new FakeCalendar(clock),
      settings: () => settings, chipAssistantId: 'chip', clock, startNudges: false,
      eagle: { llm: eagleLlm, assistantId: 'scout', documentsRoot: 'C:/Documents', openExternal: async () => {},
        gate: ({ bus }) => new StubWardenGate(bus), approvals },
    });
    const submitted = core.jobs.submit({ agent: 'eagle', task: 'Research a topic', title: 'Research',
      requestedBy: 'chipmunk', kind: 'normal', parentTaskId: 'task-1' });
    expect(submitted.jobId).toBeTruthy();
    const result = await core.jobs.waitFor(submitted.jobId!);
    expect(result.say).toBe('Found three solid sources!');
    expect(fallback).not.toHaveBeenCalled();
    expect(eagleLlm.calls[0]).toMatchObject({ kind: 'send', params: { assistantId: 'scout',
      webSearch: 'Auto', memory: 'Auto' } });
    expect(core.bus.recent().filter(event => event.type === 'agent.status' && event.agentId === 'eagle')
      .map(event => event.type === 'agent.status' && [event.status, event.detail])).toEqual([
        ['away', 'Scanning the web…'], ['idle', undefined],
      ]);
    await core.dispose();
  });

  it.each([
    ['free-form web answer', 'plain'],
    ['screen exception after the answer', 'screen'],
    ['tool exception after an interim answer', 'tool'],
    ['silent Chip result response', 'silent'],
  ] as const)('%s still returns and gives Chip a result turn', async (_name, mode) => {
    const clock = new FakeClock();
    const answer = 'NASA says Apollo 11 landed on July 20, 1969. https://www.nasa.gov/history/';
    const screenError = mode === 'screen' ? new Error('screen unavailable') : undefined;
    const eagleLlm = new FakeLlm(mode === 'tool'
      ? [{ ...requiresAction([toolCall('web_open', { url: 'https://www.nasa.gov/history/' })]), content: answer }, completed(answer)]
      : [completed(answer)]);
    const chipLlm = new FakeLlm([completed(mode === 'silent' ? '(silent)' : '[bubble: Research ready]\nScout found the NASA source.')]);
    const core = createChipCore({ llm: chipLlm, runner: { run: async () => fakeResult('eagle') },
      calendar: new FakeCalendar(clock), settings: makeTestSettings, chipAssistantId: 'chip', clock, startNudges: false,
      eagle: { llm: eagleLlm, assistantId: 'scout', documentsRoot: 'C:/Documents',
        openExternal: async () => { if (mode === 'tool') throw new Error('browser unavailable'); },
        gate: ({ bus }) => new StubWardenGate(bus), approvals,
        ...(screenError ? { screen: { screen: async () => { throw screenError; } } } : {}),
      },
    });
    try {
      const submitted = core.jobs.submit({ agent: 'eagle', task: 'Find the first Moon landing date',
        title: 'Moon landing', requestedBy: 'chipmunk', kind: 'normal', parentTaskId: 'task-web' });
      const result = await core.jobs.waitFor(submitted.jobId!);
      expect(result.ok).toBe(!screenError);
      expect(result.summary).toContain(screenError ? 'screened' : 'NASA');
      const events = core.bus.recent();
      const report = events.findIndex(e => e.type === 'agent.say' && e.agentId === 'eagle');
      const returned = events.findIndex(e => e.type === 'agent.return' && e.agentId === 'eagle');
      const terminal = events.findIndex(e => e.type === 'job.update' && e.to === 'eagle' &&
        e.state === (screenError ? 'failed' : 'done'));
      expect(report).toBeGreaterThanOrEqual(0);
      expect(returned).toBeGreaterThan(report);
      expect(terminal).toBeGreaterThan(returned);
      expect(events.some(e => e.type === 'agent.status' && e.agentId === 'eagle' && e.status === 'idle')).toBe(true);
      expect(core.jobs.list().find(j => j.jobId === submitted.jobId)?.state).toBe(screenError ? 'failed' : 'done');
      if (mode === 'tool') expect(events.some(e => e.type === 'tool.result' && e.agentId === 'eagle' && !e.ok)).toBe(true);
      await clock.advanceAsync(RESULT_BATCH_MS);
      await core.orchestrator.whenIdle();
      expect(chipLlm.calls.some(call => call.kind === 'send' && call.params.content.startsWith('[job_results]'))).toBe(true);
      expect(core.bus.recent().some(e => e.type === 'agent.say' && e.agentId === 'chipmunk' && e.priority === 'chip')).toBe(true);
    } finally { await core.dispose(); }
  });
});
