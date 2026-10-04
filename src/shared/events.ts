import type { AgentId, AgentStatus, AgentMood, UserMood, Presence } from './agents';
import type { Risk } from './tools';

interface Base {
  id: string;            // uuid v4
  ts: number;            // Date.now()
  sessionId: string;     // one per app launch
  taskId?: string;       // one per user request; shared by every event it causes
  agentId: AgentId;      // who emitted it
}

export type BiomeEvent = Base & (
  | { type: 'user.message';     text: string; source: 'text' | 'voice' }
  | { type: 'user.mood';        mood: UserMood; intensity: number; reason: string }          // 0..1
  | { type: 'agent.status';     status: AgentStatus; detail?: string }                       // detail = bubble text, e.g. "Reading 12 emails…"
  | { type: 'agent.mood';       mood: AgentMood; intensity: number; cause: AgentId | 'user' }
  | { type: 'agent.handoff';    to: AgentId; task: string; via?: AgentId }                   // Chip → specialist; via = whose result is being relayed
  | { type: 'agent.return';     to: AgentId; ok: boolean; summary: string }                  // specialist → Chip
  | { type: 'agent.say';        text: string; bubble: string; priority: 'warden' | 'chip' | 'report' | 'ack' }  // text spoken; bubble = 1–2 words; renderer plays by priority
  | { type: 'agent.presence';   presence: Presence; reason: 'idle_timeout' | 'dock_timeout' | 'user' | 'job' | 'startup' }
  | { type: 'job.update';       jobId: string; to: AgentId; state: 'queued' | 'running' | 'done' | 'failed' | 'cancelled'; title: string; position?: number; requestedBy: AgentId }
  | { type: 'agent.recall';     memories: string[] }                                         // Backboard retrieved_memories → 💭 sparkle
  | { type: 'nudge.fire';       nudgeId: string; kind: 'before' | 'after' | 'daily' | 'evening' | 'weekly' | 'custom'; about: string }
  | { type: 'tool.request';     callId: string; tool: string; args: unknown; risk: Risk }
  | { type: 'wolf.verdict';     callId: string; verdict: 'allow' | 'ask' | 'deny'; rule: string; reason: string }
  | { type: 'wolf.alert';       source: string; reason: string }                              // prompt-injection etc.
  | { type: 'approval.request'; callId: string; title: string; preview: string }
  | { type: 'approval.resolve'; callId: string; approved: boolean; how?: 'user' | 'timeout' | 'cancelled' }
  | { type: 'tool.result';      callId: string; ok: boolean; summary: string }
  | { type: 'artifact';         kind: ArtifactKind; title: string; data: unknown; openUrl?: string }
);

export type ArtifactKind = 'email_draft' | 'email_digest' | 'calendar_event' | 'file_plan' | 'file_note' | 'research_brief' | 'social_post' | 'day_plan' | 'google_doc';

export type BiomeEventType = BiomeEvent['type'];
