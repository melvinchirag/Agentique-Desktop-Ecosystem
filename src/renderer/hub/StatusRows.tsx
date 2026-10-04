import React, { useEffect, useState } from 'react';
import type { AdeShellApi } from '../../main/shell/contracts';
import type { HubStoreHook } from '../shell/contracts';
import { AGENTS } from '../../shared/config';
import type { AgentId } from '../../shared/agents';

interface StatusRowsProps {
  store: HubStoreHook;
  shell: AdeShellApi;
}

function formatElapsed(since: number, now: number): string {
  const elapsedSec = Math.max(0, Math.floor((now - since) / 1000));
  const mm = String(Math.floor(elapsedSec / 60)).padStart(2, '0');
  const ss = String(elapsedSec % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}

export const StatusRows: React.FC<StatusRowsProps> = ({ store, shell }) => {
  const agents = store((state) => state.agents);
  const [now, setNow] = useState(() => Date.now());

  const hasRunningJob = Object.values(agents).some(
    (row) => row.job != null && row.job.state === 'running'
  );

  useEffect(() => {
    if (!hasRunningJob) return;
    const interval = setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => clearInterval(interval);
  }, [hasRunningJob]);

  // Order by AGENTS definition, filtering out not_installed
  const agentIds = (Object.keys(AGENTS) as AgentId[]).filter((id) => {
    const row = agents[id];
    return row && row.presence !== 'not_installed';
  });

  return (
    <section className="hub-status-rows" aria-label="Agent status rows">
      {agentIds.map((id) => {
        const row = agents[id];
        const profile = AGENTS[id];
        const isRunning = row.job != null && row.job.state === 'running';

        return (
          <div
            key={id}
            className="hub-status-row"
            role="button"
            tabIndex={0}
            data-testid={`agent-row-${id}`}
            aria-label={`${profile.displayName}: ${row.presence}`}
            onClick={() => shell.inspectAgent(id)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                shell.inspectAgent(id);
              }
            }}
          >
            <div
              className="hub-avatar-dot"
              style={{ backgroundColor: profile.color }}
              title={profile.displayName}
            >
              {profile.displayName.charAt(0)}
            </div>

            <span className="hub-status-name">{profile.displayName}</span>

            <span className={`hub-presence-badge ${row.presence}`}>
              {row.presence}
            </span>

            <div className="hub-job-detail">
              {row.job ? (
                <>
                  <span>{row.job.title}</span>
                  {isRunning && (
                    <span className="hub-job-timer">
                      ({formatElapsed(row.job.since, now)})
                    </span>
                  )}
                </>
              ) : (
                <span style={{ color: 'var(--hub-text-muted)' }}>{row.status}</span>
              )}
            </div>

            {row.queued > 0 && (
              <span className="hub-queued-badge" title={`${row.queued} jobs queued`}>
                Q:{row.queued}
              </span>
            )}

            {row.pendingApproval && (
              <span className="hub-approval-badge" title="Approval waiting">
                ⚠️ Approval
              </span>
            )}
          </div>
        );
      })}
    </section>
  );
};
