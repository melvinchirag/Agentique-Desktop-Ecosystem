// Talking to an animal while it works: the note reaches the running job at its next tool round.
import { describe, expect, it } from 'vitest';
import { EventBus } from '../src/main/bus/eventBus';
import { AgentRuntime } from '../src/main/runtime/agentRuntime';
import { directNote, Steering } from '../src/main/runtime/steering';
import type { Approvals, JobScheduler } from '../src/main/runtime/types';
import type { AdeSettings } from '../src/shared/ipc';
import { completed, FakeLlm, requiresAction, toolCall } from '../src/main/testing/fakeLlm';

describe('steering', () => {
  it('parses direct notes to an animal and ignores everything else', () => {
    expect(directNote('Archie, skip the PDFs')).toEqual({ agent: 'beaver', note: 'skip the PDFs' });
    expect(directNote('tell Archie to skip the PDFs')).toEqual({ agent: 'beaver', note: 'skip the PDFs' });
    expect(directNote('Scout: only use sources from 2026')).toEqual({ agent: 'eagle', note: 'only use sources from 2026' });
    expect(directNote('Archie organized my desktop yesterday')).toBeUndefined();
    expect(directNote('Hi, how are you')).toBeUndefined();
    expect(directNote('Chip, what time is it')).toBeUndefined();               // Chip is not a specialist job
  });

  it('accepts a note only while the animal runs, and hands unread notes back when the job ends', () => {
    const s = new Steering();
    const back: string[] = [];
    s.onUndelivered = (_a, text) => back.push(text);
    expect(s.tell('beaver', 'skip the PDFs')).toBe(false);
    s.begin('beaver');
    expect(s.tell('beaver', 'skip the PDFs')).toBe(true);
    s.end('beaver');
    expect(back).toEqual(['skip the PDFs']);
  });

  it('delivers a mid-job note with the next round of tool results', async () => {
    const steering = new Steering();
    const llm = new FakeLlm([
      requiresAction([toolCall('fs_list', { path: 'Desktop' }, 'c1')], 'job-1'),
      completed('[say: Done]\nSkipped the PDFs.', 'job-1'),
    ]);
    const runtime = new AgentRuntime({
      bus: new EventBus(), llm, steering,
      jobs: {} as JobScheduler, approvals: {} as Approvals,
      settings: () => ({ models: {}, installed: {} }) as unknown as AdeSettings,
      agents: [{ assistantId: 'as-beaver', definition: { id: 'beaver', systemPrompt: 'Archie', maxToolRounds: 4, tools: [{
        name: 'fs_list', description: 'list', parameters: {}, risk: 'read',
        // The user speaks while the tool runs.
        execute: async () => { steering.tell('beaver', 'skip the PDFs'); return { files: ['a.pdf', 'b.txt'] }; },
      }] } }],
    });
    await runtime.run('beaver', 'clean up my Desktop', { jobId: 'j1', taskId: 't1', kind: 'normal', signal: new AbortController().signal });
    const round = llm.calls[1]!;
    if (round.kind !== 'toolOutputs') throw new Error('expected tool outputs');
    expect(JSON.parse(round.outputs[0]!.output)).toEqual({ note_from_user_while_you_work: 'skip the PDFs', tool_result: { files: ['a.pdf', 'b.txt'] } });
  });
});
