import React, { useState } from 'react';
import type { AdeApi } from '../../shared/ipc';
import type { HubStoreHook } from '../shell/contracts';
import { AGENTS } from '../../shared/config';
import type { AgentId, ModelChoice } from '../../shared/agents';
import { AVAILABLE_MODELS } from './SettingsPanel';

interface OnboardingModalProps {
  store: HubStoreHook;
  api: AdeApi;
  onFinish: () => void;
}

export function isOnboarded(): boolean {
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem('ade.onboarded') === 'true';
  } catch {
    return false;
  }
}

export function setOnboardedFlag(): void {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('ade.onboarded', 'true');
    }
  } catch {
    // Ignore storage errors
  }
}

export const OnboardingModal: React.FC<OnboardingModalProps> = ({
  store,
  api,
  onFinish,
}) => {
  const [selectedModelIdx, setSelectedModelIdx] = useState(0);
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const [googleConnected, setGoogleConnected] = useState<string | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);

  const handleConnectGoogle = async () => {
    setIsConnecting(true);
    try {
      const res = await api.connectGoogle();
      if (res?.email) {
        setGoogleConnected(res.email);
      }
    } finally {
      setIsConnecting(false);
    }
  };

  const handleComplete = async () => {
    // 1) Apply model to every animal
    const chosenModel = AVAILABLE_MODELS[selectedModelIdx].choice;
    const allAgentIds = Object.keys(AGENTS) as AgentId[];
    const models = Object.fromEntries(
      allAgentIds.map((id) => [id, chosenModel])
    ) as Record<AgentId, ModelChoice>;

    const patch = {
      models,
      voiceEnabled,
      googleEmail: googleConnected ?? undefined,
    };

    const currentSettings = store.getState().settings;
    if (currentSettings) {
      store.getState().setSettings({ ...currentSettings, ...patch });
    }
    await api.setSettings(patch);

    // Set flag and notify finish
    setOnboardedFlag();
    onFinish();
  };

  return (
    <div className="hub-onboarding-overlay" aria-label="Onboarding setup">
      <div className="hub-onboarding-box">
        <h2 style={{ fontSize: 16, fontWeight: 700, color: 'var(--hub-text-primary)' }}>
          Welcome to ADE
        </h2>
        <p style={{ fontSize: 12, color: 'var(--hub-text-secondary)' }}>
          Configure your desktop companions before entering the biome.
        </p>

        {/* 1. Pick your AI */}
        <div className="hub-setting-group">
          <div className="hub-setting-label">1. Pick Your Primary AI Model</div>
          <select
            className="hub-select"
            value={selectedModelIdx}
            onChange={(e) => setSelectedModelIdx(Number(e.target.value))}
            aria-label="Pick your AI"
          >
            {AVAILABLE_MODELS.map((m, idx) => (
              <option key={idx} value={idx}>
                {m.label}
              </option>
            ))}
          </select>
        </div>

        {/* 2. Connect Google */}
        <div className="hub-setting-group">
          <div className="hub-setting-label">2. Google Workspace (Optional)</div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 11, color: 'var(--hub-text-secondary)' }}>
              {googleConnected ? `Connected: ${googleConnected}` : 'Not connected'}
            </span>
            <button
              type="button"
              className="hub-tray-btn"
              onClick={handleConnectGoogle}
              disabled={isConnecting || Boolean(googleConnected)}
              aria-label="Connect Google Workspace"
            >
              {isConnecting ? 'Connecting...' : googleConnected ? '✓ Connected' : 'Connect Google'}
            </button>
          </div>
        </div>

        {/* 3. Voices on/off */}
        <div className="hub-setting-group">
          <div className="hub-setting-label">3. ElevenLabs Animal Voices</div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={voiceEnabled}
              onChange={(e) => setVoiceEnabled(e.target.checked)}
              aria-label="Enable voices in onboarding"
            />
            <span style={{ fontSize: 12 }}>Enable realistic voice synthesis</span>
          </label>
        </div>

        {/* 4. Pixel writing style (disabled) */}
        <div className="hub-setting-group">
          <div className="hub-setting-label">4. Pixel Learning Style</div>
          <div
            style={{
              padding: '6px 8px',
              borderRadius: 6,
              background: 'rgba(255, 255, 255, 0.05)',
              color: 'var(--hub-text-muted)',
              fontSize: 11,
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <span>Pixel is learning how you write</span>
            <span style={{ fontSize: 9, padding: '2px 4px', borderRadius: 4, background: '#2c3038' }}>
              Coming soon
            </span>
          </div>
        </div>

        {/* Finish button */}
        <button
          type="button"
          className="hub-send-btn"
          style={{ width: '100%', marginTop: 8 }}
          onClick={handleComplete}
          aria-label="Finish onboarding"
        >
          Enter Biome
        </button>
      </div>
    </div>
  );
};
