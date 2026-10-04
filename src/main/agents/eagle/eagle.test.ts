import { describe, expect, it, vi } from 'vitest';
import { createEagleAgent } from './index';
import { briefPath, createEagleTools, safeWebUrl } from './tools';
import { parseSpecialistOutput } from '../../runtime/specialistOutput';
import { createChipCore } from '../../chipCore';
import { FakeClock } from '../../runtime/clock';
import { FakeCalendar } from '../../testing/fakeCalendar';
import { completed, FakeLlm } from '../../testing/fakeLlm';
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
        ['away', 'Scanning the web…'], ['done', undefined],
      ]);
    await core.dispose();
  });
});
