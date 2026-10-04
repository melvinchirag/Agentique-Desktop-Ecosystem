import { describe, expect, it } from 'vitest';
import { AGENTS } from '../../shared/config';
import type { BiomeEventInput } from '../../main/runtime/types';
import { makeEvent } from './mocks';
import { createHubStore, initialHubState, reduceHubEvent } from './hubStore';

const apply = (input: BiomeEventInput, ts = 10) => reduceHubEvent(initialHubState(), makeEvent(input, ts));

describe('Hub reducer', () => {
  it('starts all eight agents with tier presence and idle neutral state', () => {
    const state = initialHubState();
    expect(Object.keys(state.agents)).toEqual(Object.keys(AGENTS));
    for (const profile of Object.values(AGENTS)) {
      expect(state.agents[profile.id]).toMatchObject({ presence: profile.tier === 'core' ? 'active' : 'not_installed', status: 'idle', mood: 'neutral', job: null, queued: 0 });
    }
  });
  it('records user.message', () => {
    expect(apply({ type: 'user.message', agentId: 'chipmunk', text: 'hello', source: 'text' }).transcript[0]).toMatchObject({ from: 'user', kind: 'user', text: 'hello' });
  });
  it('records user.mood', () => {
    expect(apply({ type: 'user.mood', agentId: 'chipmunk', mood: 'stressed', intensity: 0.6, reason: 'busy' }).userMood).toEqual({ mood: 'stressed', intensity: 0.6 });
  });
  it('sets agent.status and clears missing detail', () => {
    const first = apply({ type: 'agent.status', agentId: 'eagle', status: 'away', detail: 'Browsing' });
    const second = reduceHubEvent(first, makeEvent({ type: 'agent.status', agentId: 'eagle', status: 'idle' }, 11));
    expect(first.agents.eagle).toMatchObject({ status: 'away', detail: 'Browsing' });
    expect(second.agents.eagle.detail).toBeUndefined();
  });
  it('sets agent.mood', () => {
    expect(apply({ type: 'agent.mood', agentId: 'chipmunk', mood: 'happy', intensity: 0.8, cause: 'user' }).agents.chipmunk.mood).toBe('happy');
  });
  it('sets agent.presence', () => {
    expect(apply({ type: 'agent.presence', agentId: 'ants', presence: 'sleeping', reason: 'idle_timeout' }).agents.ants.presence).toBe('sleeping');
  });
  it('records agent.say and lastBubble', () => {
    const state = apply({ type: 'agent.say', agentId: 'workspace', text: 'Full reply', bubble: 'Short', priority: 'report' });
    expect(state.transcript[0]).toMatchObject({ from: 'workspace', kind: 'say', text: 'Full reply' });
    expect(state.agents.workspace.lastBubble).toBe('Short');
  });
  it('records agent.recall', () => {
    expect(apply({ type: 'agent.recall', agentId: 'chipmunk', memories: ['one', 'two'] }).transcript[0].text).toBe('💭 Remembered: one; two');
  });
  it('records wolf.alert', () => {
    expect(apply({ type: 'wolf.alert', agentId: 'wolf', source: 'page', reason: 'unsafe' }).transcript[0]).toMatchObject({ from: 'wolf', kind: 'alert', text: 'unsafe' });
  });
  it('records nudge.fire', () => {
    expect(apply({ type: 'nudge.fire', agentId: 'chipmunk', nudgeId: 'n1', kind: 'daily', about: 'midterm' }).transcript[0]).toMatchObject({ from: 'chipmunk', kind: 'system', text: 'midterm' });
  });
  it('upserts jobs, preserves since for unchanged state, recomputes running and queued, and keeps terminal jobs', () => {
    const job = (jobId: string, state: 'queued' | 'running' | 'done', ts: number) => makeEvent({ type: 'job.update', agentId: 'chipmunk', jobId, to: 'workspace', state, title: jobId, requestedBy: 'chipmunk' }, ts);
    let state = reduceHubEvent(initialHubState(), job('a', 'queued', 10));
    state = reduceHubEvent(state, job('b', 'queued', 11));
    expect(state.agents.workspace.queued).toBe(2);
    state = reduceHubEvent(state, job('a', 'running', 12));
    expect(state.agents.workspace).toMatchObject({ queued: 1, job: { jobId: 'a', since: 12 } });
    state = reduceHubEvent(state, job('a', 'running', 13));
    expect(state.jobs.a.since).toBe(12);
    state = reduceHubEvent(state, job('a', 'done', 14));
    expect(state.jobs.a.state).toBe('done');
    expect(state.agents.workspace.job).toBeNull();
    expect(state.agents.workspace.queued).toBe(1);
  });
  it('maps tool.request calls to agents', () => {
    expect(apply({ type: 'tool.request', agentId: 'beaver', callId: 'c', tool: 'fs_move', args: {}, risk: 'write' }).calls.c).toBe('beaver');
  });
  it('tracks approval.request with the tool caller and marks its agent', () => {
    const requested = apply({ type: 'tool.request', agentId: 'beaver', callId: 'c', tool: 'fs_move', args: {}, risk: 'write' });
    const state = reduceHubEvent(requested, makeEvent({ type: 'approval.request', agentId: 'wolf', callId: 'c', title: 'Move', preview: '12 files' }, 11));
    expect(state.approvals[0]).toMatchObject({ callId: 'c', agentId: 'beaver', title: 'Move', preview: '12 files', ts: 11 });
    expect(state.agents.beaver.pendingApproval).toBe(true);
  });
  it('removes approval.resolve and recomputes the agent flag', () => {
    const request = (id: string) => makeEvent({ type: 'approval.request', agentId: 'beaver', callId: id, title: id, preview: id });
    let state = reduceHubEvent(reduceHubEvent(initialHubState(), request('a')), request('b'));
    state = reduceHubEvent(state, makeEvent({ type: 'approval.resolve', agentId: 'wolf', callId: 'a', approved: true }));
    expect(state.agents.beaver.pendingApproval).toBe(true);
    state = reduceHubEvent(state, makeEvent({ type: 'approval.resolve', agentId: 'wolf', callId: 'b', approved: false }));
    expect(state.agents.beaver.pendingApproval).toBe(false);
    expect(state.approvals).toEqual([]);
  });
  it('prepends artifact tray items with event ids', () => {
    const event = makeEvent({ type: 'artifact', agentId: 'workspace', kind: 'email_draft', title: 'Draft', data: {}, openUrl: 'https://example.com' }, 12);
    expect(reduceHubEvent(initialHubState(), event).tray[0]).toMatchObject({ id: event.id, ts: 12, title: 'Draft', openUrl: 'https://example.com' });
  });
  it('updates only lastEventTs for other events', () => {
    const state = initialHubState();
    const next = reduceHubEvent(state, makeEvent({ type: 'agent.handoff', agentId: 'chipmunk', to: 'eagle', task: 'search' }, 42));
    expect(next).toEqual({ ...state, lastEventTs: 42 });
  });
  it('never mutates its input or nested collections', () => {
    const state = initialHubState();
    const before = structuredClone(state);
    const next = reduceHubEvent(state, makeEvent({ type: 'agent.status', agentId: 'eagle', status: 'away' }));
    expect(state).toEqual(before);
    expect(next.agents).not.toBe(state.agents);
    expect(next.agents.eagle).not.toBe(state.agents.eagle);
  });
  it('caps transcript at 200 and tray at 50', () => {
    let state = initialHubState();
    for (let n = 0; n < 205; n++) state = reduceHubEvent(state, makeEvent({ type: 'user.message', agentId: 'chipmunk', source: 'text', text: `${n}` }, n));
    expect(state.transcript).toHaveLength(200);
    expect(state.transcript[0].text).toBe('5');
    for (let n = 0; n < 55; n++) state = reduceHubEvent(state, makeEvent({ type: 'artifact', agentId: 'workspace', kind: 'email_draft', title: `${n}`, data: {} }, n));
    expect(state.tray).toHaveLength(50);
    expect(state.tray[0].title).toBe('54');
    expect(state.tray.at(-1)?.title).toBe('5');
  });
  it('store actions apply, set flags, and reset', () => {
    const store = createHubStore({ dnd: true });
    store.getState().applyEvent(makeEvent({ type: 'user.message', agentId: 'chipmunk', source: 'text', text: 'Hi' }));
    store.getState().setDnd(false);
    store.getState().setAnimalsHidden(true);
    store.getState().setReplaying(true);
    expect(store.getState()).toMatchObject({ dnd: false, animalsHidden: true, replaying: true });
    store.getState().reset({ dnd: true });
    expect(store.getState().transcript).toEqual([]);
    expect(store.getState().dnd).toBe(true);
  });
});
