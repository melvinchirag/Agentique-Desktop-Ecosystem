import React, { useState } from 'react';
import type { AdeApi } from '../../shared/ipc';
import type { AdeShellApi } from '../../main/shell/contracts';
import type { HubStoreHook } from '../shell/contracts';
import { AGENTS } from '../../shared/config';
import type { AgentId, ModelChoice } from '../../shared/agents';

interface SettingsPanelProps {
  store: HubStoreHook;
  api: AdeApi;
  shell: AdeShellApi;
  onClose: () => void;
}

export const AVAILABLE_MODELS: { label: string; choice: ModelChoice }[] = [
  { label: 'OpenAI GPT-4o', choice: { llm_provider: 'openai', model_name: 'gpt-4o' } },
  { label: 'OpenAI GPT-4o-mini', choice: { llm_provider: 'openai', model_name: 'gpt-4o-mini' } },
  { label: 'Anthropic Claude Sonnet 4', choice: { llm_provider: 'anthropic', model_name: 'claude-sonnet-4-20250514' } },
  { label: 'Google Gemini 2.5 Pro', choice: { llm_provider: 'google', model_name: 'gemini-2.5-pro' } },
];

export const SettingsPanel: React.FC<SettingsPanelProps> = ({
  store,
  api,
  shell,
  onClose,
}) => {
  const settings = store((state) => state.settings);
  const [newFolder, setNewFolder] = useState('');
  const [connectingGoogle, setConnectingGoogle] = useState(false);
  const [googleError, setGoogleError] = useState('');

  const currentModels = settings?.models ?? ({} as Record<AgentId, ModelChoice>);
  const voiceEnabled = settings?.voiceEnabled ?? true;
  const sfxEnabled = settings?.sfxEnabled ?? true;
  const ambienceEnabled = settings?.ambienceEnabled ?? false;
  const demoMode = settings?.demoMode ?? false;
  const allowedFolders = settings?.allowedFolders ?? [];
  const googleEmail = settings?.googleEmail;
  const timers = settings?.timers ?? { sleepAfterSec: 180, dockAfterSec: 600, moodDecaySec: 20 };

  const handleModelChange = async (agentId: AgentId, modelKey: string) => {
    const selected = AVAILABLE_MODELS.find(
      (m) => `${m.choice.llm_provider}:${m.choice.model_name}` === modelKey
    );
    if (!selected) return;

    const nextModels = { ...currentModels, [agentId]: selected.choice };
    store.getState().setSettings({ ...settings!, models: nextModels });
    await api.setSettings({ models: nextModels });
  };

  const handleToggleVoice = async () => {
    const next = !voiceEnabled;
    store.getState().setSettings({ ...settings!, voiceEnabled: next });
    await api.setSettings({ voiceEnabled: next });
  };

  const handleToggleSfx = async () => {
    const next = !sfxEnabled;
    store.getState().setSettings({ ...settings!, sfxEnabled: next });
    await api.setSettings({ sfxEnabled: next });
  };

  const handleToggleAmbience = async () => {
    const next = !ambienceEnabled;
    store.getState().setSettings({ ...settings!, ambienceEnabled: next });
    await api.setSettings({ ambienceEnabled: next });
  };

  const handleToggleDemoMode = async () => {
    const next = !demoMode;
    store.getState().setSettings({ ...settings!, demoMode: next });
    await api.setSettings({ demoMode: next });
  };

  const handleAddFolder = async (e: React.FormEvent) => {
    e.preventDefault();
    const folder = newFolder.trim();
    if (!folder || allowedFolders.includes(folder)) return;

    const nextFolders = [...allowedFolders, folder];
    setNewFolder('');
    store.getState().setSettings({ ...settings!, allowedFolders: nextFolders });
    await api.setSettings({ allowedFolders: nextFolders });
  };

  const handleRemoveFolder = async (folderToRemove: string) => {
    const nextFolders = allowedFolders.filter((f) => f !== folderToRemove);
    store.getState().setSettings({ ...settings!, allowedFolders: nextFolders });
    await api.setSettings({ allowedFolders: nextFolders });
  };

  const handleConnectGoogle = async () => {
    setConnectingGoogle(true);
    setGoogleError('');
    try {
      const res = await api.connectGoogle();
      if (res?.email && settings) {
        store.getState().setSettings({ ...settings, googleEmail: res.email });
      }
    } catch (error) {
      setGoogleError(error instanceof Error ? error.message : 'Google connection failed.');
    } finally {
      setConnectingGoogle(false);
    }
  };
  const handleDisconnectGoogle = async () => {
    try {
      await api.disconnectGoogle();
      if (settings) store.getState().setSettings({ ...settings, googleEmail: undefined });
      setGoogleError('');
    } catch (error) { setGoogleError(error instanceof Error ? error.message : 'Google disconnect failed.'); }
  };

  const agentIds = Object.keys(AGENTS) as AgentId[];

  return (
    <div className="hub-panel-overlay" aria-label="Settings panel">
      <div className="hub-panel-header">
        <h2 className="hub-panel-title">Settings</h2>
        <button
          type="button"
          className="hub-icon-btn"
          onClick={onClose}
          aria-label="Close settings"
        >
          ✕
        </button>
      </div>

      {/* Model Per Animal */}
      <div className="hub-setting-group">
        <div className="hub-setting-label">AI Model Per Animal</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {agentIds.map((id) => {
            const profile = AGENTS[id];
            const choice = currentModels[id];
            const currentValueKey = choice
              ? `${choice.llm_provider}:${choice.model_name}`
              : 'openai:gpt-4o';

            return (
              <div
                key={id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 8,
                }}
              >
                <span style={{ fontSize: 11, width: 80, color: profile.color, fontWeight: 600 }}>
                  {profile.displayName}
                </span>
                <select
                  className="hub-select"
                  value={currentValueKey}
                  onChange={(e) => handleModelChange(id, e.target.value)}
                  aria-label={`Model for ${profile.displayName}`}
                >
                  {AVAILABLE_MODELS.map((m) => (
                    <option
                      key={`${m.choice.llm_provider}:${m.choice.model_name}`}
                      value={`${m.choice.llm_provider}:${m.choice.model_name}`}
                    >
                      {m.label}
                    </option>
                  ))}
                </select>
              </div>
            );
          })}
        </div>
      </div>

      {/* Voice Toggle */}
      <div className="hub-setting-group">
        <div className="hub-setting-label">Voice & Sound</div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={voiceEnabled}
            onChange={handleToggleVoice}
            aria-label="Enable voices"
          />
          <span style={{ fontSize: 12 }}>Enable ElevenLabs Voices</span>
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
          <input type="checkbox" checked={sfxEnabled} onChange={handleToggleSfx} aria-label="Sound effects" />
          <span style={{ fontSize: 12 }}>Sound effects</span>
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
          <input type="checkbox" checked={ambienceEnabled} onChange={handleToggleAmbience} aria-label="Ambience" />
          <span style={{ fontSize: 12 }}>Ambience</span>
        </label>
      </div>

      {/* Allowed Folders */}
      <div className="hub-setting-group">
        <div className="hub-setting-label">Archie Allowed Folders</div>
        <form onSubmit={handleAddFolder} style={{ display: 'flex', gap: 6 }}>
          <input
            type="text"
            className="hub-chat-input"
            placeholder="Add folder path (e.g. C:/Projects)"
            value={newFolder}
            onChange={(e) => setNewFolder(e.target.value)}
            aria-label="New folder path"
          />
          <button type="submit" className="hub-tray-btn" aria-label="Add folder">
            Add
          </button>
        </form>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 4 }}>
          {allowedFolders.length === 0 ? (
            <span style={{ fontSize: 11, color: 'var(--hub-text-muted)' }}>
              No custom sandbox folders specified.
            </span>
          ) : (
            allowedFolders.map((folder) => (
              <div
                key={folder}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  background: 'var(--hub-surface)',
                  padding: '4px 8px',
                  borderRadius: 4,
                  fontSize: 11,
                }}
              >
                <span>{folder}</span>
                <button
                  type="button"
                  className="hub-icon-btn"
                  onClick={() => handleRemoveFolder(folder)}
                  aria-label={`Remove folder ${folder}`}
                >
                  ✕
                </button>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Timers Display & Demo Mode */}
      <div className="hub-setting-group">
        <div className="hub-setting-label">Timers & Demo Mode</div>
        <div style={{ fontSize: 11, color: 'var(--hub-text-secondary)', marginBottom: 4 }}>
          Sleep: {timers.sleepAfterSec}s · Dock: {timers.dockAfterSec}s · Mood Decay: {timers.moodDecaySec}s
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={demoMode}
            onChange={handleToggleDemoMode}
            aria-label="Demo mode"
          />
          <span style={{ fontSize: 12 }}>Demo Mode (30s sleep, 60s dock)</span>
        </label>
      </div>

      {/* Google Connect */}
      <div className="hub-setting-group">
        <div className="hub-setting-label">Google Workspace</div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 11, color: 'var(--hub-text-secondary)' }}>
            {googleEmail ? `Connected: ${googleEmail}` : 'Not connected'}
          </span>
          <button
            type="button"
            className="hub-tray-btn"
            onClick={handleConnectGoogle}
            disabled={connectingGoogle}
            aria-label="Connect Google"
          >
            {connectingGoogle ? 'Connecting...' : googleEmail ? 'Reconnect' : 'Connect Google'}
          </button>
          {googleEmail && <button type="button" className="hub-tray-btn" onClick={handleDisconnectGoogle} aria-label="Disconnect Google">Disconnect</button>}
        </div>
        {googleError && <div role="alert" style={{ fontSize: 11, color: '#f29b9b', marginTop: 5 }}>{googleError}</div>}
      </div>

      {/* Asset Lab Button */}
      <div className="hub-setting-group" style={{ marginTop: 'auto', paddingTop: 10 }}>
        <button
          type="button"
          className="hub-send-btn"
          style={{ width: '100%', background: '#383e4c' }}
          onClick={() => shell.openAssetLab()}
          aria-label="Open Asset Lab"
        >
          🧪 Open Asset Lab
        </button>
      </div>
    </div>
  );
};
