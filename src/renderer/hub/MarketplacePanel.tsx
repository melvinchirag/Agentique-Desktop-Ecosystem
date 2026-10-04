import React from 'react';
import type { AdeApi } from '../../shared/ipc';
import type { HubStoreHook } from '../shell/contracts';
import { AGENTS } from '../../shared/config';
import type { AgentId } from '../../shared/agents';

interface MarketplacePanelProps {
  store: HubStoreHook;
  api: AdeApi;
  onClose: () => void;
}

export const MarketplacePanel: React.FC<MarketplacePanelProps> = ({
  store,
  api,
  onClose,
}) => {
  const agents = store((state) => state.agents);
  const agentIds = Object.keys(AGENTS) as AgentId[];

  const handleWake = async (agentId: AgentId) => {
    await api.wakeAgent(agentId);
  };

  return (
    <div className="hub-panel-overlay" aria-label="Marketplace panel">
      <div className="hub-panel-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <h2 className="hub-panel-title">ADE Marketplace</h2>
          <span
            style={{
              fontSize: 10,
              padding: '2px 6px',
              borderRadius: 10,
              background: 'rgba(45, 206, 137, 0.15)',
              color: 'var(--hub-success)',
              fontWeight: 600,
            }}
          >
            🛡️ Verified by Warden
          </span>
        </div>
        <button
          type="button"
          className="hub-icon-btn"
          onClick={onClose}
          aria-label="Close marketplace"
        >
          ✕
        </button>
      </div>

      {/* 8 Animal Cards */}
      <div className="hub-setting-group">
        <div className="hub-setting-label">Companion Animals (8)</div>
        <div className="hub-market-grid">
          {agentIds.map((id) => {
            const profile = AGENTS[id];
            const row = agents[id];
            const isDocked = row?.presence === 'docked';
            const isInstalled = row?.presence !== 'not_installed';

            return (
              <div key={id} className="hub-market-card">
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <div
                    className="hub-avatar-dot"
                    style={{ backgroundColor: profile.color, width: 18, height: 18, fontSize: 9 }}
                  >
                    {profile.displayName.charAt(0)}
                  </div>
                  <span style={{ fontWeight: 600, fontSize: 11 }}>{profile.displayName}</span>
                </div>

                <div style={{ fontSize: 10, color: 'var(--hub-text-muted)', height: 26, overflow: 'hidden' }}>
                  {profile.role}
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 }}>
                  <span style={{ fontSize: 9, color: 'var(--hub-text-secondary)', textTransform: 'capitalize' }}>
                    {isInstalled ? (isDocked ? 'Docked' : 'Active') : 'Available'}
                  </span>

                  {isDocked ? (
                    <button
                      type="button"
                      className="hub-tray-btn"
                      onClick={() => handleWake(id)}
                      aria-label={`Wake ${profile.displayName}`}
                    >
                      Wake
                    </button>
                  ) : (
                    <span style={{ fontSize: 9, color: 'var(--hub-success)' }}>
                      Installed
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Community Agents */}
      <div className="hub-setting-group">
        <div className="hub-setting-label">Community Agents</div>
        <div
          style={{
            padding: 10,
            borderRadius: 6,
            background: 'var(--hub-surface)',
            border: '1px dashed var(--hub-border)',
            textAlign: 'center',
            color: 'var(--hub-text-muted)',
            fontSize: 11,
          }}
        >
          🧩 Community agent store and custom Python skills coming soon!
        </div>
      </div>

      {/* Skins */}
      <div className="hub-setting-group">
        <div className="hub-setting-label">Character Skins</div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <div
            style={{
              padding: '4px 8px',
              borderRadius: 6,
              background: 'rgba(94, 114, 228, 0.2)',
              border: '1px solid var(--hub-accent)',
              fontSize: 11,
              color: 'var(--hub-text-primary)',
            }}
          >
            ✓ Forest Native (Equipped)
          </div>
          <div
            style={{
              padding: '4px 8px',
              borderRadius: 6,
              background: 'var(--hub-surface)',
              border: '1px solid var(--hub-border)',
              fontSize: 11,
              color: 'var(--hub-text-muted)',
            }}
          >
            Winter Coat (Soon)
          </div>
          <div
            style={{
              padding: '4px 8px',
              borderRadius: 6,
              background: 'var(--hub-surface)',
              border: '1px solid var(--hub-border)',
              fontSize: 11,
              color: 'var(--hub-text-muted)',
            }}
          >
            Cyberpunk (Soon)
          </div>
        </div>
      </div>

      {/* Biomes */}
      <div className="hub-setting-group">
        <div className="hub-setting-label">Biomes</div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <div
            style={{
              padding: '4px 8px',
              borderRadius: 6,
              background: 'rgba(45, 206, 137, 0.2)',
              border: '1px solid var(--hub-success)',
              fontSize: 11,
              color: 'var(--hub-text-primary)',
            }}
          >
            ✓ Temperate Forest
          </div>
          <div
            style={{
              padding: '4px 8px',
              borderRadius: 6,
              background: 'var(--hub-surface)',
              border: '1px solid var(--hub-border)',
              fontSize: 11,
              color: 'var(--hub-text-muted)',
            }}
          >
            Desert Dunes (Soon)
          </div>
          <div
            style={{
              padding: '4px 8px',
              borderRadius: 6,
              background: 'var(--hub-surface)',
              border: '1px solid var(--hub-border)',
              fontSize: 11,
              color: 'var(--hub-text-muted)',
            }}
          >
            Arctic Tundra (Soon)
          </div>
        </div>
      </div>
    </div>
  );
};
