import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { AgentId } from '../src/shared/agents';
import type { ToolDefinition, ToolInspection, Risk } from '../src/shared/tools';
import type { GateRequest } from '../src/main/runtime/types';
import { EventBus } from '../src/main/bus/eventBus';
import { WardenGateImpl } from '../src/main/wolf/gate';
import { evaluate, hasForbiddenSegment } from '../src/main/wolf/rules';
import { inspectCall } from '../src/main/wolf/inspect';
import { beaverAgent } from '../src/main/agents/beaver';

const localFixture = path.join(__dirname, 'fixtures/warden/rule-matrix.json');
const fixture = existsSync(localFixture) ? localFixture : path.resolve(__dirname, '../../warden-x/tests/fixtures/warden/rule-matrix.json');
type MatrixRow = { id: string; agentId: AgentId; tool: string; risk: Risk; args: unknown; inspect: ToolInspection;
  jobKind: 'normal' | 'help'; tainted: boolean; priorDenied: boolean; priorDeclined: boolean;
  expect: { verdict: string; rule: string };
  setup?: { throwAt?: string; registered?: boolean; declaredRisk?: Risk; riskFor?: Risk; fileBytes?: Record<string, number> } };

describe('Warden rule table', () => {
  it.skipIf(!existsSync(fixture))('matches the reviewed W1-W17 matrix after fixture merge', () => {
    const rows = JSON.parse(readFileSync(fixture, 'utf8')) as MatrixRow[];
    const base = path.resolve('tests/fixtures/sandbox');
    const roots = ['Desktop', 'Documents', 'Downloads'].map(name => path.join(base, name));
    for (const row of rows) {
      const bus = new EventBus();
      const tool: ToolDefinition = { name: row.tool, description: '', parameters: {}, risk: row.setup?.declaredRisk ?? row.risk,
        execute: async () => undefined,
        inspect: () => { if (row.setup?.throwAt === 'inspect') throw new Error('probe'); return row.inspect; },
        riskFor: row.setup?.throwAt === 'riskFor' ? () => { throw new Error('probe'); } : row.setup?.riskFor ? () => row.setup!.riskFor! : undefined };
      const gate = new WardenGateImpl({ bus, settings: { allowedFolders: roots, demoMode: false },
        registry: () => { if (row.setup?.throwAt === 'registry') throw new Error('probe'); return row.setup?.registered === false ? [] : [tool]; },
        exists: () => true,
        realpath: input => { if (row.setup?.throwAt === 'realpath') throw new Error('probe'); return input; },
        fileSize: input => row.setup?.fileBytes?.[path.relative(base, input).replace(/\\/g, '/')] ?? 0,
        documentsRoot: roots[1] });
      const request: GateRequest = { agentId: row.agentId, taskId: row.id, callId: row.id, jobId: row.id,
        jobKind: row.jobKind, tool: row.tool, risk: row.risk, args: row.args };
      if (row.tainted) gate.taint(row.id);
      if (row.priorDenied || row.priorDeclined) gate.noteDeclined(row.id, gate.callKey(row.tool, row.args));
      const verdict = gate.review(request);
      expect([verdict, gate.explain(row.id)?.rule], row.id).toEqual([row.expect.verdict, row.expect.rule]);
      gate.dispose();
    }
  });

  it('merges nested array paths and inspection details', () => {
    const got = inspectCall({ moves: [{ from: 'Downloads/a', to: 'Documents/a' }], attendees: ['a@example.test'] },
      { inspect: () => ({ paths: ['Desktop/b'], count: 26 }) });
    expect(got.paths).toEqual(['Downloads/a', 'Documents/a', 'Desktop/b']);
    expect(got.hasAttendees).toBe(true);
    expect(got.count).toBe(26);
  });

  it('asks on an existing draft target, while a new draft target is allowed', () => {
    const request: GateRequest = { agentId: 'workspace', taskId: 't', callId: 'c', jobId: 'j', jobKind: 'normal',
      tool: 'gmail_create_draft', risk: 'draft', args: {} };
    const tool = { name: request.tool, risk: 'draft', riskFor: undefined } as ToolDefinition;
    const base = { tool, inspection: { writesPaths: ['Documents/draft.md'], paths: ['Documents/draft.md'] }, pathAllowed: () => true };
    expect(evaluate(request, { ...base, exists: () => false })).toMatchObject({ verdict: 'allow', rule: 'W2' });
    expect(evaluate(request, { ...base, exists: () => true })).toMatchObject({ verdict: 'ask', rule: 'W3' });
    expect(evaluate(request, { ...base, exists: () => true, tainted: true })).toMatchObject({ verdict: 'ask', rule: 'W16' });
  });

  it('W28: registered tools have no external risk or send-like segment and changes have previews', () => {
    for (const registered of beaverAgent.tools) {
      expect(registered.risk, registered.name).not.toBe('external');
      expect(hasForbiddenSegment(registered.name), registered.name).toBe(false);
      if (registered.risk === 'write' || registered.risk === 'destructive')
        expect(registered.preview, registered.name).toBeTypeOf('function');
    }
  });
});
