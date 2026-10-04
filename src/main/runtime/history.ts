import type { AgentId } from '../../shared/agents';
import type { BiomeEvent } from '../../shared/events';
import type { Bus, Clock, HistoryKind, HistoryStore } from './types';

const MAX_ROWS = 20;
const DEFAULT_SINCE_HOURS = 24;

/**
 * In-memory `biome_history` over the bus ring buffer (Chip spec §10.5).
 * The `agent` filter means: recent_tasks → tasks that animal emitted an event in;
 * warden_blocks → blocks of that animal's tool calls; agent_activity → that animal's row;
 * mood_history → events that animal emitted.
 */
export class MemoryHistoryStore implements HistoryStore {
  private readonly bus: Bus;
  private readonly clock: Clock;

  constructor(deps: { bus: Bus; clock: Clock }) {
    this.bus = deps.bus;
    this.clock = deps.clock;
  }

  async query(kind: HistoryKind, sinceHours: number, agent?: AgentId): Promise<object[]> {
    const all = this.bus.recent();
    const hours = Number.isFinite(sinceHours) ? sinceHours : DEFAULT_SINCE_HOURS;
    const cutoff = this.clock.now() - hours * 3600 * 1000;
    const events = all.filter((e) => e.ts >= cutoff);
    switch (kind) {
      case 'recent_tasks':
        return recentTasks(events, agent);
      case 'warden_blocks':
        return wardenBlocks(events, all, agent);
      case 'agent_activity':
        return agentActivity(events, agent);
      case 'mood_history':
        return moodHistory(events, agent);
    }
  }
}

const iso = (ts: number): string => new Date(ts).toISOString();

function recentTasks(events: BiomeEvent[], agent?: AgentId): object[] {
  const groups = new Map<string, BiomeEvent[]>();
  for (const e of events) {
    if (!e.taskId) continue;
    const group = groups.get(e.taskId);
    if (group) group.push(e);
    else groups.set(e.taskId, [e]);
  }
  const rows: { at: string; asked: string; answered: string | null }[] = [];
  for (const group of groups.values()) {
    if (agent && !group.some((e) => e.agentId === agent)) continue;
    const first = group.find((e) => e.type === 'user.message');
    if (!first || first.type !== 'user.message') continue;
    let answered: string | null = null;
    for (const e of group) if (e.type === 'agent.say' && e.agentId === 'chipmunk') answered = e.text;
    rows.push({ at: iso(group[0]!.ts), asked: first.text, answered });
  }
  return rows.reverse().slice(0, MAX_ROWS);
}

function wardenBlocks(events: BiomeEvent[], all: BiomeEvent[], agent?: AgentId): object[] {
  const requests = new Map<string, { agent: AgentId; tool: string }>();
  for (const e of all) if (e.type === 'tool.request') requests.set(e.callId, { agent: e.agentId, tool: e.tool });
  const rows: { at: string; agent: AgentId | null; tool: string | null; rule: string; reason: string }[] = [];
  for (const e of events) {
    if (e.type !== 'wolf.verdict' || e.verdict !== 'deny') continue;
    const req = requests.get(e.callId);
    if (agent && req?.agent !== agent) continue;
    rows.push({ at: iso(e.ts), agent: req?.agent ?? null, tool: req?.tool ?? null, rule: e.rule, reason: e.reason });
  }
  return rows.reverse().slice(0, MAX_ROWS);
}

function agentActivity(events: BiomeEvent[], agent?: AgentId): object[] {
  const counts = new Map<AgentId, { agent: AgentId; jobs: number; actions: number }>();
  const row = (id: AgentId) => {
    let r = counts.get(id);
    if (!r) counts.set(id, (r = { agent: id, jobs: 0, actions: 0 }));
    return r;
  };
  for (const e of events) {
    if (e.type === 'job.update' && e.state === 'done') row(e.to).jobs++;
    else if (e.type === 'tool.result') row(e.agentId).actions++;
  }
  return [...counts.values()]
    .filter((r) => !agent || r.agent === agent)
    .sort((a, b) => b.jobs - a.jobs || b.actions - a.actions || a.agent.localeCompare(b.agent))
    .slice(0, MAX_ROWS);
}

function moodHistory(events: BiomeEvent[], agent?: AgentId): object[] {
  const rows: { at: string; mood: string; intensity: number }[] = [];
  for (const e of events) {
    if (e.type !== 'user.mood' || (agent && e.agentId !== agent)) continue;
    rows.push({ at: iso(e.ts), mood: e.mood, intensity: e.intensity });
  }
  return rows.reverse().slice(0, MAX_ROWS);
}
