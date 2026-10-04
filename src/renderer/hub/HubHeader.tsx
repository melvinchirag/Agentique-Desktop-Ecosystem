import React, { useState } from 'react';
import type { AdeApi } from '../../shared/ipc';
import type { AdeShellApi } from '../../main/shell/contracts';
import type { HubStoreHook } from '../shell/contracts';
import { AGENTS } from '../../shared/config';
import type { AgentId } from '../../shared/agents';

interface HubHeaderProps {
  store: HubStoreHook;
  api: AdeApi;
  shell: AdeShellApi;
  collapsed: boolean;
  onToggleCollapse: () => void;
  onOpenSettings: () => void;
  onOpenMarketplace: () => void;
}

export const HubHeader: React.FC<HubHeaderProps> = ({
  store,
  api,
  shell,
  collapsed,
  onToggleCollapse,
  onOpenSettings,
  onOpenMarketplace,
}) => {
  const userMood = store((state) => state.userMood);
  const dnd = store((state) => state.dnd);
  const animalsHidden = store((state) => state.animalsHidden);
  const agents = store((state) => state.agents);

  const [dropdownOpen, setDropdownOpen] = useState(false);

  const dockedAgents = Object.values(agents).filter((row) => row.presence === 'docked');

  const handleToggleDnd = async () => {
    const next = !dnd;
    store.getState().setDnd(next);
    await api.setDoNotDisturb(next);
  };

  const handleToggleHideAnimals = () => {
    const next = !animalsHidden;
    store.getState().setAnimalsHidden(next);
    shell.hideAnimals(next);
  };

  const handleWakeAgent = async (agentId: AgentId) => {
    await api.wakeAgent(agentId);
    setDropdownOpen(false);
  };

  return (
    <header className="hub-header" style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}>
      <div className="hub-header-left">
        <button
          type="button"
          className="hub-logo-btn hub-no-drag"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          onClick={onOpenMarketplace}
          title="Open Marketplace"
          aria-label="Marketplace"
        >
          <span style={{ color: 'var(--hub-chip)' }}>●</span> ADE
        </button>
        {userMood && (
          <span className="hub-user-mood-chip hub-no-drag" title={`Mood: ${userMood.mood} (${Math.round(userMood.intensity * 100)}%)`}>
            {userMood.mood}
          </span>
        )}
      </div>

      <div className="hub-header-controls hub-no-drag" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
        {/* Agents ▾ Dropdown */}
        <div className="hub-dropdown-container">
          <button
            type="button"
            className="hub-icon-btn"
            onClick={() => setDropdownOpen((prev) => !prev)}
            aria-label="Agents dropdown"
            title="Docked Agents"
          >
            Agents ▾
          </button>
          {dropdownOpen && (
            <div className="hub-dropdown-menu">
              {dockedAgents.length === 0 ? (
                <div className="hub-dropdown-empty">No docked agents</div>
              ) : (
                dockedAgents.map((row) => (
                  <button
                    key={row.id}
                    type="button"
                    className="hub-dropdown-item"
                    onClick={() => handleWakeAgent(row.id)}
                  >
                    <span
                      className="hub-avatar-dot"
                      style={{ backgroundColor: AGENTS[row.id]?.color ?? '#888' }}
                    >
                      {AGENTS[row.id]?.displayName.charAt(0) ?? row.id.charAt(0).toUpperCase()}
                    </span>
                    <span>Wake {AGENTS[row.id]?.displayName ?? row.id}</span>
                  </button>
                ))
              )}
            </div>
          )}
        </div>

        {/* DND Toggle */}
        <button
          type="button"
          className={`hub-icon-btn ${dnd ? 'active' : ''}`}
          onClick={handleToggleDnd}
          aria-label="Toggle Do Not Disturb"
          title={dnd ? 'DND: On' : 'DND: Off'}
        >
          {dnd ? '🔕 DND' : '🔔 DND'}
        </button>

        {/* Hide Animals Toggle */}
        <button
          type="button"
          className={`hub-icon-btn ${animalsHidden ? 'active' : ''}`}
          onClick={handleToggleHideAnimals}
          aria-label="Toggle Hide Animals"
          title={animalsHidden ? 'Show Animals' : 'Hide Animals'}
        >
          {animalsHidden ? '🙈 Calm' : '👀 Live'}
        </button>

        {/* Settings button */}
        <button
          type="button"
          className="hub-icon-btn"
          onClick={onOpenSettings}
          aria-label="Settings"
          title="Settings"
        >
          ⚙
        </button>

        {/* Collapse button */}
        <button
          type="button"
          className="hub-icon-btn"
          onClick={onToggleCollapse}
          aria-label={collapsed ? 'Expand Hub' : 'Collapse Hub'}
          title={collapsed ? 'Expand' : 'Collapse'}
        >
          {collapsed ? '▾' : '▴'}
        </button>
      </div>
    </header>
  );
};
