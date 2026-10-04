import React, { useEffect, useRef, useState } from 'react';
import type { HubAppComponent } from '../shell/contracts';
import type { HubTab } from '../../main/shell/contracts';
import type { AgentId } from '../../shared/agents';
import { HubHeader } from './HubHeader';
import { StatusRows } from './StatusRows';
import { TraySection } from './TraySection';
import { ChatTab } from './ChatTab';
import { MemoriesTab } from './MemoriesTab';
import { PulseTab } from './PulseTab';
import { AuditTab } from './AuditTab';
import { SettingsPanel } from './SettingsPanel';
import { MarketplacePanel } from './MarketplacePanel';
import { OnboardingModal, isOnboarded } from './OnboardingModal';
import './hub.css';

export const HubApp: HubAppComponent = ({ store, api, shell }) => {
  const [activeTab, setActiveTab] = useState<HubTab>('chat');
  const [previousTab, setPreviousTab] = useState<HubTab>('chat');
  const [collapsed, setCollapsed] = useState(false);
  const [selectedMemoryAgent, setSelectedMemoryAgent] = useState<AgentId>('chipmunk');
  const [showOnboarding, setShowOnboarding] = useState(() => !isOnboarded());

  const chatInputRef = useRef<HTMLInputElement>(null);

  // Keyboard navigation: Escape blurs Hub
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        shell.blurHub();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [shell]);

  // Wire Shell API listeners
  useEffect(() => {
    const unsubFocus = shell.onFocusChat(() => {
      setActiveTab('chat');
      // Timeout ensures DOM update / visibility
      setTimeout(() => {
        chatInputRef.current?.focus();
      }, 0);
    });

    const unsubTab = shell.onOpenHubTab((tab, agentId) => {
      setActiveTab(tab);
      if (tab === 'memories' && agentId) {
        setSelectedMemoryAgent(agentId);
      }
    });

    const unsubHotkey = shell.onDemoHotkey((key) => {
      if (key === 'hideAnimals') {
        const next = !store.getState().animalsHidden;
        store.getState().setAnimalsHidden(next);
        shell.hideAnimals(next);
      }
    });

    const unsubLayout = shell.onLayoutChanged((layout) => {
      store.getState().setAnimalsHidden(layout.animalsHidden);
      if (layout.hubCollapsed !== undefined) {
        setCollapsed(layout.hubCollapsed);
      }
    });

    const unsubSettings = shell.onSettingsChanged((settings) => {
      store.getState().setSettings(settings);
    });

    return () => {
      unsubFocus();
      unsubTab();
      unsubHotkey();
      unsubLayout();
      unsubSettings();
    };
  }, [shell, store]);

  const handleToggleCollapse = () => {
    const next = !collapsed;
    setCollapsed(next);
    shell.setHubCollapsed(next);
  };

  const handleOpenSettings = () => {
    if (activeTab === 'settings') {
      setActiveTab(previousTab === 'settings' ? 'chat' : previousTab);
    } else {
      setPreviousTab(activeTab);
      setActiveTab('settings');
    }
  };

  const handleOpenMarketplace = () => {
    if (activeTab === 'marketplace') {
      setActiveTab(previousTab === 'marketplace' ? 'chat' : previousTab);
    } else {
      setPreviousTab(activeTab);
      setActiveTab('marketplace');
    }
  };

  const handleCloseOverlayPanel = () => {
    setActiveTab(previousTab === 'settings' || previousTab === 'marketplace' ? 'chat' : previousTab);
  };

  const mainTabs: { key: HubTab; label: string }[] = [
    { key: 'chat', label: 'Chat' },
    { key: 'memories', label: 'Memories' },
    { key: 'pulse', label: 'Pulse' },
    { key: 'audit', label: 'Audit' },
  ];

  return (
    <main
      className={`hub-root ${collapsed ? 'collapsed' : ''}`}
      data-testid="hub-root"
      aria-label="Agent Hub"
    >
      <HubHeader
        store={store}
        api={api}
        shell={shell}
        collapsed={collapsed}
        onToggleCollapse={handleToggleCollapse}
        onOpenSettings={handleOpenSettings}
        onOpenMarketplace={handleOpenMarketplace}
      />

      {!collapsed && (
        <>
          {/* Always visible under header */}
          <StatusRows store={store} shell={shell} />

          {/* Artifact Tray */}
          <TraySection store={store} />

          {/* Tabs bar */}
          <nav className="hub-nav-tabs" role="tablist" aria-label="Hub main tabs">
            {mainTabs.map((t) => (
              <button
                key={t.key}
                type="button"
                role="tab"
                aria-selected={activeTab === t.key}
                className={`hub-tab-btn ${activeTab === t.key ? 'active' : ''}`}
                onClick={() => setActiveTab(t.key)}
              >
                {t.label}
              </button>
            ))}
          </nav>

          {/* Tab content */}
          <div className="hub-body">
            {activeTab === 'chat' && (
              <ChatTab store={store} api={api} shell={shell} inputRef={chatInputRef} />
            )}
            {activeTab === 'memories' && (
              <MemoriesTab
                api={api}
                selectedAgentId={selectedMemoryAgent}
                onSelectAgent={setSelectedMemoryAgent}
              />
            )}
            {activeTab === 'pulse' && <PulseTab api={api} />}
            {activeTab === 'audit' && <AuditTab api={api} shell={shell} />}

            {/* Overlays / Full panels */}
            {activeTab === 'settings' && (
              <SettingsPanel
                store={store}
                api={api}
                shell={shell}
                onClose={handleCloseOverlayPanel}
              />
            )}
            {activeTab === 'marketplace' && (
              <MarketplacePanel
                store={store}
                api={api}
                onClose={handleCloseOverlayPanel}
              />
            )}
          </div>
        </>
      )}

      {/* First-run Onboarding */}
      {showOnboarding && (
        <OnboardingModal
          store={store}
          api={api}
          onFinish={() => setShowOnboarding(false)}
        />
      )}
    </main>
  );
};
