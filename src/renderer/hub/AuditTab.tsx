import React, { useEffect, useState } from 'react';
import type { AdeApi } from '../../shared/ipc';
import type { AdeShellApi } from '../../main/shell/contracts';
import type { AgentId } from '../../shared/agents';
import { AGENTS } from '../../shared/config';

export interface WardenAuditRow {
  ts: number;
  taskId?: string;
  agentId: AgentId;
  tool: string;
  verdict: 'allow' | 'ask' | 'deny';
  rule: string;
  reason: string;
}

interface AuditTabProps {
  api: AdeApi;
  shell: AdeShellApi;
}

export const AuditTab: React.FC<AuditTabProps> = ({ api, shell }) => {
  const [rows, setRows] = useState<WardenAuditRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let active = true;
    api
      .getWardenAudit(50)
      .then((data) => {
        if (active) {
          setRows(Array.isArray(data) ? (data as WardenAuditRow[]) : []);
          setIsLoading(false);
        }
      })
      .catch(() => {
        if (active) {
          setRows([]);
          setIsLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [api]);

  const handleReplay = (taskId: string) => {
    shell.replayTask(taskId);
  };

  return (
    <div className="hub-audit-container" aria-label="Warden audit log">
      {isLoading ? (
        <div style={{ color: 'var(--hub-text-muted)', padding: 12, textAlign: 'center' }}>
          Loading audit entries...
        </div>
      ) : rows.length === 0 ? (
        <div style={{ color: 'var(--hub-text-muted)', padding: 16, textAlign: 'center' }}>
          No audit entries recorded yet.
        </div>
      ) : (
        rows.map((row, idx) => {
          const profile = AGENTS[row.agentId];
          const timeStr = row.ts
            ? new Date(row.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
            : '';

          return (
            <div
              key={`${row.ts}-${idx}`}
              className="hub-audit-row"
              data-testid={`audit-row-${idx}`}
            >
              <div className="hub-audit-header">
                <span
                  className="hub-audit-agent"
                  style={{ color: profile?.color ?? 'var(--hub-text-primary)' }}
                >
                  {profile?.displayName ?? row.agentId}
                </span>

                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span className={`hub-verdict-chip ${row.verdict}`}>
                    {row.verdict}
                  </span>
                  <span className="hub-audit-time">{timeStr}</span>
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontWeight: 600, color: 'var(--hub-text-primary)' }}>
                  {row.tool}
                </span>

                {row.taskId && (
                  <button
                    type="button"
                    className="hub-tray-btn"
                    onClick={() => handleReplay(row.taskId!)}
                    aria-label={`Replay task ${row.taskId}`}
                  >
                    ▶ Replay
                  </button>
                )}
              </div>

              {row.rule && (
                <div style={{ color: 'var(--hub-text-secondary)', fontSize: 10 }}>
                  Rule: {row.rule}
                </div>
              )}

              {row.reason && (
                <div style={{ color: 'var(--hub-text-muted)', fontSize: 10 }}>
                  Reason: {row.reason}
                </div>
              )}
            </div>
          );
        })
      )}
    </div>
  );
};
