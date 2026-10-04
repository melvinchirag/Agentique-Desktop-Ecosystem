import React, { useEffect, useState } from 'react';
import type { BiomeEvent } from '../../shared/events';
import type { AdeApi } from '../../shared/ipc';
import type { AdeShellApi } from '../../main/shell/contracts';

export const TimelineTab: React.FC<{ api: AdeApi; shell: AdeShellApi }> = ({ api, shell }) => {
  const [events, setEvents] = useState<BiomeEvent[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    const now = Date.now();
    api.getTimeline(now - 24 * 60 * 60 * 1000, now).then(rows => {
      if (active) setEvents(rows);
    }).catch(cause => {
      if (active) setError(cause instanceof Error ? cause.message : String(cause));
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [api]);

  const tasks = new Map<string, { ts: number; title: string; count: number }>();
  for (const event of events) {
    if (!event.taskId) continue;
    const previous = tasks.get(event.taskId);
    const title = event.type === 'user.message' ? event.text : previous?.title ?? event.type;
    tasks.set(event.taskId, { ts: previous?.ts ?? event.ts, title, count: (previous?.count ?? 0) + 1 });
  }

  return <div className="hub-timeline-container" aria-label="Timeline">
    {loading ? <p>Loading timeline...</p> : error ? <p role="alert">{error}</p> : tasks.size === 0 ? <p>No tasks recorded today.</p> :
      <div className="hub-timeline-strip" style={{ display: 'flex', gap: 8, overflowX: 'auto', padding: 8 }}>
        {[...tasks].reverse().map(([taskId, task]) => <div key={taskId} className="hub-audit-row" style={{ minWidth: 170 }}>
          <div className="hub-audit-time">{new Date(task.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
          <div title={task.title} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{task.title}</div>
          <small>{task.count} events</small>
          <button type="button" className="hub-tray-btn" onClick={() => shell.replayTask(taskId)} aria-label={`Replay task ${taskId}`}>Replay</button>
        </div>)}
      </div>}
  </div>;
};
