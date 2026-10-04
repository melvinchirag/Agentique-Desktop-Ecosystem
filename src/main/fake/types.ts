import type { AgentId, UserMood } from '../../shared/agents';
import type { BiomeEventInput } from '../runtime/types';
export interface DemoScript { name: string; keywords: string[]; steps: { atMs: number; event: BiomeEventInput }[]; approval?: { callId: string; approved: readonly { atMs: number; event: BiomeEventInput }[]; denied: readonly { atMs: number; event: BiomeEventInput }[] } }
export type FakePulse = { moodWeek: { day: 'Mon'|'Tue'|'Wed'|'Thu'|'Fri'|'Sat'|'Sun'; mood: UserMood; score: number }[]; jobsPerAgent: Partial<Record<AgentId, number>>; wardenBlocks: number; wardenAsks: number };
export type FakeAuditRow = { ts: number; taskId?: string; agentId: AgentId; tool: string; verdict: 'allow'|'ask'|'deny'; rule: string; reason: string };
