import { create } from 'zustand';
import { AGENTS } from '../../shared/config';
import type { AgentId } from '../../shared/agents';
import type { BiomeEvent } from '../../shared/events';
import type { AgentRow, HubState, HubStore, HubStoreHook, JobInfo, ReduceHubEvent, TranscriptLine } from './contracts';

export function initialHubState(): HubState {
  const agents = Object.fromEntries(Object.values(AGENTS).map(profile => [profile.id, {
    id: profile.id,
    presence: profile.tier === 'core' ? 'active' : 'not_installed',
    status: 'idle',
    mood: 'neutral',
    job: null,
    queued: 0,
    pendingApproval: false,
  }])) as Record<AgentId, AgentRow>;
  return {
    agents, jobs: {}, calls: {}, userMood: null, transcript: [], tray: [], approvals: [],
    settings: null, dnd: false, animalsHidden: false, replaying: false, lastEventTs: 0,
  };
}

const appendLine = (state: HubState, e: BiomeEvent, line: Pick<TranscriptLine, 'from' | 'kind' | 'text'>): HubState => ({
  ...state,
  transcript: [...state.transcript, { id: e.id, ts: e.ts, ...line }].slice(-200),
});

const updateAgent = (state: HubState, id: AgentId, patch: Partial<AgentRow>): HubState => ({
  ...state, agents: { ...state.agents, [id]: { ...state.agents[id], ...patch } },
});

export const reduceHubEvent: ReduceHubEvent = (state, e) => {
  const next: HubState = { ...state, lastEventTs: e.ts };
  switch (e.type) {
    case 'user.message': return appendLine(next, e, { from: 'user', kind: 'user', text: e.text });
    case 'user.mood': return { ...next, userMood: { mood: e.mood, intensity: e.intensity } };
    case 'agent.status': {
      return updateAgent(next, e.agentId, { status: e.status, detail: e.detail });
    }
    case 'agent.mood': return updateAgent(next, e.agentId, { mood: e.mood });
    case 'agent.presence': return updateAgent(next, e.agentId, { presence: e.presence });
    case 'agent.say': return updateAgent(appendLine(next, e, { from: e.agentId, kind: 'say', text: e.text }), e.agentId, { lastBubble: e.bubble });
    case 'agent.recall': return appendLine(next, e, { from: e.agentId, kind: 'recall', text: `💭 Remembered: ${e.memories.join('; ')}` });
    case 'wolf.alert': return appendLine(next, e, { from: 'wolf', kind: 'alert', text: e.reason });
    case 'nudge.fire': return appendLine(next, e, { from: 'chipmunk', kind: 'system', text: e.about });
    case 'job.update': {
      const previous = next.jobs[e.jobId];
      const job: JobInfo = {
        jobId: e.jobId, to: e.to, title: e.title, state: e.state, requestedBy: e.requestedBy,
        since: previous?.state === e.state ? previous.since : e.ts,
      };
      const jobs = { ...next.jobs, [e.jobId]: job };
      const forAgent = Object.values(jobs).filter(item => item.to === e.to);
      const running = forAgent.filter(item => item.state === 'running').sort((a, b) => b.since - a.since)[0] ?? null;
      return updateAgent({ ...next, jobs }, e.to, {
        job: running,
        queued: forAgent.filter(item => item.state === 'queued').length,
      });
    }
    case 'tool.request': return { ...next, calls: { ...next.calls, [e.callId]: e.agentId } };
    case 'approval.request': {
      const agentId = next.calls[e.callId] ?? e.agentId;
      const approvals = [...next.approvals, { callId: e.callId, agentId, title: e.title, preview: e.preview, ts: e.ts }];
      return updateAgent({ ...next, approvals }, agentId, { pendingApproval: true });
    }
    case 'approval.resolve': {
      const removed = next.approvals.find(item => item.callId === e.callId);
      const approvals = next.approvals.filter(item => item.callId !== e.callId);
      if (!removed) return { ...next, approvals };
      return updateAgent({ ...next, approvals }, removed.agentId, { pendingApproval: approvals.some(item => item.agentId === removed.agentId) });
    }
    case 'artifact': return {
      ...next,
      tray: [{ id: e.id, ts: e.ts, agentId: e.agentId, kind: e.kind, title: e.title, data: e.data, openUrl: e.openUrl }, ...next.tray].slice(0, 50),
    };
    default: return next;
  }
};

export function createHubStore(seed: Partial<HubState> = {}): HubStoreHook {
  return create<HubStore>((set) => ({
    ...initialHubState(), ...seed,
    applyEvent: e => set(state => reduceHubEvent(state, e)),
    setSettings: settings => set({ settings }),
    setDnd: dnd => set({ dnd }),
    setAnimalsHidden: animalsHidden => set({ animalsHidden }),
    setReplaying: replaying => set({ replaying }),
    reset: (patch = {}) => set({ ...initialHubState(), ...patch }),
  }));
}
