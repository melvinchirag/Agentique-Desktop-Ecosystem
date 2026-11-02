import type { AgentId } from '../../shared/agents';
import type { WardenAuditRow } from '../../renderer/hub/responses';

/** Convert an audit query row into the Audit tab response (03-warden-security.md §8). */
export function mapWardenAuditRow(row: Record<string, unknown>): WardenAuditRow {
  const taskId = row.task_id == null ? undefined : String(row.task_id);
  const ts = row.ts instanceof Date ? row.ts.getTime() : new Date(String(row.ts)).getTime();
  const verdict = row.verdict === 'allow' || row.verdict === 'ask' || row.verdict === 'deny' ? row.verdict : 'alert';
  return {
    ts,
    ...(taskId ? { taskId } : {}),
    agentId: String(row.asking_agent ?? row.agent_id ?? 'wolf') as AgentId,
    tool: String(row.tool ?? ''),
    verdict,
    rule: String(row.rule ?? ''),
    reason: String(row.reason ?? ''),
  };
}

/** What Warden did today: the four numbers on his inspect card. */
export interface WardenCounts { allowed: number; asked: number; denied: number; alerts: number }
