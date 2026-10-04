import type { BiomeEventInput } from '../../main/runtime/types';
import type { HubState } from './contracts';
import { initialHubState, reduceHubEvent } from './hubStore';
import { makeEvent } from './mocks';

/** A useful static scene for Hub and overlay work before the real core is connected. */
export function demoSeedState(): Partial<HubState> {
  const events: BiomeEventInput[] = [
    { type: 'user.message', agentId: 'chipmunk', text: 'Please handle my email digest and find pizza nearby.', source: 'text' },
    { type: 'user.mood', agentId: 'chipmunk', mood: 'stressed', intensity: 0.6, reason: 'busy day' },
    { type: 'agent.say', agentId: 'chipmunk', text: 'I can help with both.', bubble: 'On it!', priority: 'chip' },
    { type: 'agent.recall', agentId: 'chipmunk', memories: ['You like concise summaries'] },
    { type: 'job.update', agentId: 'chipmunk', jobId: 'email-1', to: 'workspace', state: 'running', title: 'Email digest', requestedBy: 'chipmunk' },
    { type: 'agent.status', agentId: 'workspace', status: 'working', detail: 'Reading inbox' },
    { type: 'agent.say', agentId: 'workspace', text: 'I am drafting your digest.', bubble: 'Drafting', priority: 'report' },
    { type: 'job.update', agentId: 'chipmunk', jobId: 'pizza-1', to: 'eagle', state: 'running', title: 'Pizza near me', requestedBy: 'chipmunk' },
    { type: 'agent.status', agentId: 'eagle', status: 'away', detail: 'Pizza near me' },
    { type: 'agent.say', agentId: 'eagle', text: 'Searching for local pizza.', bubble: 'Searching', priority: 'report' },
    { type: 'job.update', agentId: 'chipmunk', jobId: 'files-1', to: 'beaver', state: 'queued', title: 'Move 12 files', requestedBy: 'chipmunk' },
    { type: 'tool.request', agentId: 'beaver', callId: 'move-12', tool: 'fs_move', args: { count: 12 }, risk: 'write' },
    { type: 'approval.request', agentId: 'wolf', callId: 'move-12', title: 'Move 12 files', preview: 'Move files into project folders' },
    { type: 'agent.presence', agentId: 'ants', presence: 'sleeping', reason: 'idle_timeout' },
    { type: 'artifact', agentId: 'workspace', kind: 'email_draft', title: 'Email digest draft', data: { summary: 'Inbox highlights' }, openUrl: 'https://mail.google.com/' },
    { type: 'artifact', agentId: 'eagle', kind: 'research_brief', title: 'Pizza research brief', data: { places: 3 } },
    { type: 'nudge.fire', agentId: 'chipmunk', nudgeId: 'break', kind: 'custom', about: 'Take a short break when you can.' },
  ];
  const state = events.reduce((state, input, index) => reduceHubEvent(state, makeEvent(input, 1_000 + index)), initialHubState());
  return state;
}
