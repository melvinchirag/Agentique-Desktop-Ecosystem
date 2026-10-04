import React, { useEffect, useState } from 'react';
import type { AdeApi } from '../../shared/ipc';
import type { AgentId } from '../../shared/agents';
import { AGENTS } from '../../shared/config';
import type { PulseResponse } from './responses';

interface PulseTabProps {
  api: AdeApi;
}

export const PulseTab: React.FC<PulseTabProps> = ({ api }) => {
  const [pulse, setPulse] = useState<PulseResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let active = true;
    api
      .getPulse()
      .then((data) => {
        if (active) {
          setPulse(data as PulseResponse);
          setIsLoading(false);
        }
      })
      .catch(() => {
        if (active) {
          setPulse(null);
          setIsLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [api]);

  if (isLoading) {
    return (
      <div className="hub-pulse-container" style={{ textAlign: 'center', color: 'var(--hub-text-muted)' }}>
        Loading pulse metrics...
      </div>
    );
  }

  const moodWeek = Array.isArray(pulse?.moodWeek) ? pulse!.moodWeek : [];
  const jobsPerAgent = pulse?.jobsPerAgent && typeof pulse.jobsPerAgent === 'object' ? pulse.jobsPerAgent : {};
  const wardenBlocks = typeof pulse?.wardenBlocks === 'number' ? pulse.wardenBlocks : 0;
  const wardenAsks = typeof pulse?.wardenAsks === 'number' ? pulse.wardenAsks : 0;

  const jobEntries = Object.entries(jobsPerAgent) as [AgentId, number][];
  const maxJobs = Math.max(1, ...jobEntries.map(([, count]) => count ?? 0));

  return (
    <div className="hub-pulse-container" aria-label="Biome Pulse statistics">
      {/* Warden Stats */}
      <div>
        <div className="hub-section-title">Warden Security Activity</div>
        <div className="hub-stat-grid">
          <div className="hub-stat-card" data-testid="warden-blocks-stat">
            <div className="hub-stat-num" style={{ color: 'var(--hub-danger)' }}>
              {wardenBlocks}
            </div>
            <div className="hub-stat-desc">Warden Blocks</div>
          </div>
          <div className="hub-stat-card" data-testid="warden-asks-stat">
            <div className="hub-stat-num" style={{ color: 'var(--hub-warning)' }}>
              {wardenAsks}
            </div>
            <div className="hub-stat-desc">Warden Inquiries</div>
          </div>
        </div>
      </div>

      {/* Mood This Week */}
      <div>
        <div className="hub-section-title">Mood This Week</div>
        {moodWeek.length === 0 ? (
          <div style={{ color: 'var(--hub-text-muted)', fontSize: 11 }}>
            No mood records yet this week.
          </div>
        ) : (
          moodWeek.map((item, idx) => {
            const pct = Math.max(5, Math.min(100, Math.round(item.score * 100)));
            return (
              <div key={`${item.day}-${idx}`} className="hub-bar-row">
                <span className="hub-bar-label">{item.day}</span>
                <span style={{ fontSize: 10, width: 50, color: 'var(--hub-text-secondary)' }}>
                  {item.mood}
                </span>
                <div className="hub-bar-track">
                  <div
                    className="hub-bar-fill"
                    style={{
                      width: `${pct}%`,
                      backgroundColor: 'var(--hub-accent)',
                    }}
                  />
                </div>
                <span style={{ fontSize: 10, width: 30, textAlign: 'right', color: 'var(--hub-text-muted)' }}>
                  {pct}%
                </span>
              </div>
            );
          })
        )}
      </div>

      {/* Jobs Per Agent */}
      <div>
        <div className="hub-section-title">Jobs Completed Per Agent</div>
        {jobEntries.length === 0 ? (
          <div style={{ color: 'var(--hub-text-muted)', fontSize: 11 }}>
            No agent jobs recorded yet.
          </div>
        ) : (
          jobEntries.map(([agentId, count]) => {
            const profile = AGENTS[agentId];
            const name = profile?.displayName ?? agentId;
            const pct = Math.max(5, Math.min(100, Math.round(((count ?? 0) / maxJobs) * 100)));

            return (
              <div key={agentId} className="hub-bar-row">
                <span className="hub-bar-label" title={name}>
                  {name}
                </span>
                <div className="hub-bar-track">
                  <div
                    className="hub-bar-fill"
                    style={{
                      width: `${pct}%`,
                      backgroundColor: profile?.color ?? 'var(--hub-accent)',
                    }}
                  />
                </div>
                <span style={{ fontSize: 10, width: 25, textAlign: 'right', color: 'var(--hub-text-muted)' }}>
                  {count ?? 0}
                </span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
