import React, { useState } from 'react';
import type { HubStoreHook, TrayItem } from '../shell/contracts';
import { AGENTS } from '../../shared/config';

interface TraySectionProps {
  store: HubStoreHook;
}

export const TraySection: React.FC<TraySectionProps> = ({ store }) => {
  const tray = store((state) => state.tray);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  if (tray.length === 0) {
    return null;
  }

  const handleCopy = async (item: TrayItem) => {
    const textRendering =
      typeof item.data === 'string'
        ? item.data
        : JSON.stringify(item.data, null, 2);
    const content = `${item.title}\n${textRendering}`;

    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(content);
        setCopiedId(item.id);
        setTimeout(() => setCopiedId(null), 1500);
      } catch {
        // Fallback or ignore
      }
    }
  };

  const handleOpenGmail = (openUrl?: string) => {
    if (openUrl && typeof window !== 'undefined') {
      window.open(openUrl, '_blank');
    }
  };

  return (
    <section className="hub-tray" aria-label="Artifact tray">
      <span className="hub-tray-label">Tray</span>
      {tray.map((item) => {
        const profile = AGENTS[item.agentId];
        const isEmailDraft = item.kind === 'email_draft' && Boolean(item.openUrl);

        return (
          <div key={item.id} className="hub-tray-item" title={item.title}>
            <span
              className="hub-avatar-dot"
              style={{
                width: 14,
                height: 14,
                fontSize: 8,
                backgroundColor: profile?.color ?? '#888',
              }}
            >
              {profile?.displayName.charAt(0) ?? '?'}
            </span>
            <span className="hub-tray-title">{item.title}</span>
            {isEmailDraft ? (
              <button
                type="button"
                className="hub-tray-btn"
                onClick={() => handleOpenGmail(item.openUrl)}
                aria-label={`Open in Gmail: ${item.title}`}
              >
                Open in Gmail
              </button>
            ) : (
              <button
                type="button"
                className="hub-tray-btn"
                onClick={() => handleCopy(item)}
                aria-label={`Copy ${item.title}`}
              >
                {copiedId === item.id ? 'Copied!' : 'Copy'}
              </button>
            )}
          </div>
        );
      })}
    </section>
  );
};
