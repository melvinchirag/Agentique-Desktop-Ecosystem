import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { EventBus } from '../src/main/bus/eventBus';
import type { GateRequest } from '../src/main/runtime/types';
import type { ToolDefinition } from '../src/shared/tools';
import { WardenGateImpl } from '../src/main/wolf/gate';

const base = path.resolve('tests/fixtures/sandbox');
const roots = ['Desktop', 'Documents', 'Downloads'].map(name => path.join(base, name));
const tool = (name: string, risk: ToolDefinition['risk']): ToolDefinition =>
  ({ name, risk, description: '', parameters: {}, execute: async () => undefined });
const request = (toolName: string, args: unknown = {}, risk: ToolDefinition['risk'] = 'read', callId = 'c'): GateRequest =>
  ({ agentId: 'beaver', taskId: 't', jobId: 'j', jobKind: 'normal', callId, tool: toolName, risk, args });

describe('Warden gate', () => {
  it('fails closed without exposing thrown error text', () => {
    const bus = new EventBus();
    const gate = new WardenGateImpl({ bus, settings: { allowedFolders: roots, demoMode: false },
      registry: () => { throw new Error('secret 123'); } });
    expect(gate.review(request('fs_list'))).toBe('deny');
    expect(gate.explain('c')).toMatchObject({ rule: 'W0' });
    expect(JSON.stringify(bus.recent())).not.toContain('secret 123');
    expect(bus.recent().some(event => event.type === 'wolf.alert')).toBe(true);
  });

  it('preserves the first deny rule while alerting on a repeat, then clears job state', () => {
    const bus = new EventBus();
    const gate = new WardenGateImpl({ bus, settings: { allowedFolders: roots, demoMode: false }, registry: {} });
    expect(gate.review(request('gmail_send', {}, 'read', 'one'))).toBe('deny');
    expect(gate.review(request('gmail_send', {}, 'read', 'two'))).toBe('deny');
    expect(gate.explain('two')?.rule).toBe('W1');
    expect(bus.recent().some(event => event.type === 'wolf.alert' && event.source === 'loop:gmail_send')).toBe(true);
    bus.emit({ type: 'job.update', agentId: 'chipmunk', jobId: 'j', to: 'beaver', state: 'done', title: 'Done', requestedBy: 'chipmunk' });
    gate.review(request('gmail_send', {}, 'read', 'three'));
    expect(bus.recent().filter(event => event.type === 'wolf.alert' && event.source === 'loop:gmail_send')).toHaveLength(1);
  });

  it('blocks protected roots and junction targets even when explicitly allowed', () => {
    const bus = new EventBus();
    const protectedRoot = path.join(base, 'Documents', 'AppData');
    const gate = new WardenGateImpl({ bus, settings: { allowedFolders: [protectedRoot], demoMode: false },
      registry: { beaver: [tool('fs_list', 'read')] }, exists: () => true, realpath: p => p });
    expect(gate.review(request('fs_list', { path: path.join(protectedRoot, 'secret.txt') }))).toBe('deny');
    expect(gate.explain('c')?.rule).toBe('W5');
    const linkGate = new WardenGateImpl({ bus, settings: { allowedFolders: roots, demoMode: false },
      registry: { beaver: [tool('fs_list', 'read')] }, exists: () => true,
      realpath: p => p.endsWith('link') ? path.join(base, 'Documents', '.git') : p });
    expect(linkGate.review(request('fs_list', { path: 'Downloads/link' }, 'read', 'link'))).toBe('deny');
    expect(linkGate.explain('link')?.rule).toBe('W5');
  });

  it('allows read-only ADE Trash access and denies generic writes into it', () => {
    const bus = new EventBus();
    const gate = new WardenGateImpl({ bus, settings: { allowedFolders: roots, demoMode: false },
      registry: { beaver: [tool('fs_read_text', 'read'), tool('fs_move', 'write')] },
      exists: () => true, realpath: p => p, documentsRoot: roots[1] });
    expect(gate.review(request('fs_read_text', { path: 'Documents/ADE Trash/batch/a.txt' }, 'read', 'read-trash'))).toBe('allow');
    expect(gate.explain('read-trash')?.rule).toBe('W2');
    expect(gate.review(request('fs_move', { from: 'Downloads/a.txt', to_folder: 'Documents/ADE Trash/batch' }, 'write', 'write-trash'))).toBe('deny');
    expect(gate.explain('write-trash')?.rule).toBe('W5');
  });

  it('routes the demo send probe through W1 only in demo mode', () => {
    const bus = new EventBus();
    const options = { bus, registry: {}, settings: { allowedFolders: roots, demoMode: true } };
    const gate = new WardenGateImpl(options);
    expect(gate.runDemoSendProbe({ agentId: 'workspace', taskId: 'demo', jobId: 'demo-job' })).toBe('deny');
    expect(bus.recent()).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'tool.request', tool: 'gmail_send_probe', args: expect.objectContaining({ probe: 'demo' }) }),
      expect.objectContaining({ type: 'wolf.verdict', rule: 'W1' }),
    ]));
    const count = bus.recent().length;
    new WardenGateImpl({ ...options, settings: { ...options.settings, demoMode: false } })
      .runDemoSendProbe({ agentId: 'workspace', taskId: 'normal', jobId: 'normal-job' });
    expect(bus.recent()).toHaveLength(count);
  });

  it('treats malformed tool inspection and risk as W0', () => {
    for (const candidate of [
      { ...tool('fs_list', 'read'), inspect: () => ({ count: Number.NaN }) },
      { ...tool('fs_list', 'read'), inspect: () => Promise.resolve({ paths: ['Downloads/a.txt'] }) as unknown as ReturnType<NonNullable<ToolDefinition['inspect']>> },
      { ...tool('fs_list', 'read'), inspect: () => [] as unknown as ReturnType<NonNullable<ToolDefinition['inspect']>> },
      { ...tool('fs_list', 'read'), riskFor: () => 'WRITE' as ToolDefinition['risk'] },
    ]) {
      const bus = new EventBus();
      const gate = new WardenGateImpl({ bus, settings: { allowedFolders: roots, demoMode: false }, registry: { beaver: [candidate] } });
      expect(gate.review(request('fs_list', {}, 'read'))).toBe('deny');
      expect(gate.explain('c')?.rule).toBe('W0');
    }
  });
});
