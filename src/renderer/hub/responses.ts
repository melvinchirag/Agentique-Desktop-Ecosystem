import type { AgentId } from '../../shared/agents';
import type { WardenCounts } from '../../main/store/tigerWarden';

/** The response consumed by the Hub and returned by both live and demo cores. */
export interface PulseResponse {
  moodWeek: { day: string; mood: string; score: number }[];
  jobsPerAgent: Partial<Record<AgentId, number>>;
  wardenBlocks: number;
  wardenAsks: number;
  // Other Tiger Pulse consumers also use these aggregate details.
  mood: object[];
  jobs: object[];
  activity: object[];
  warden: WardenCounts;
  pixel: { draftsToday: number; waiting: number };
}

export interface WardenAuditRow {
  ts: number;
  taskId?: string;
  agentId: AgentId;
  tool: string;
  verdict: 'allow' | 'ask' | 'deny' | 'alert';
  rule: string;
  reason: string;
}
