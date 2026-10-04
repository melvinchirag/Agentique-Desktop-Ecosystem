/** Globals the preload exposes to every renderer page (FROZEN in Wave 0). */
import type { AdeApi } from '../../shared/ipc';
import type { AdeShellApi } from '../../main/shell/contracts';

declare global {
  interface Window {
    ade: AdeApi;
    adeShell: AdeShellApi;
  }
}

export {};
