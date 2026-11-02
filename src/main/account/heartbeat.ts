import type { AccountStore, StoredAccount } from './store';
import type { SupabaseAccountClient } from './supabase';

export const DAY_MS = 24 * 60 * 60 * 1000;

export class AccountHeartbeat {
  private timer?: ReturnType<typeof setInterval>;
  private lastSent = 0;
  private active?: Promise<void>;
  private logged = false;
  constructor(private readonly store: AccountStore, private readonly client: SupabaseAccountClient,
    private readonly version: string, private readonly now: () => number = Date.now,
    private readonly log: (message: string) => void = message => console.warn(message)) {}

  start(): void {
    if (this.timer) return;
    void this.tick();
    this.timer = setInterval(() => void this.tick(), DAY_MS);
    this.timer.unref?.();
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    await this.active;
    this.lastSent = 0;
  }

  tick(): Promise<void> {
    if (this.active) return this.active;
    this.active = this.runTick().finally(() => { this.active = undefined; });
    return this.active;
  }

  private async runTick(): Promise<void> {
    if (this.now() - this.lastSent < DAY_MS) return;
    try {
      let account = await this.store.load();
      if (!account) return;
      if (account.expiresAt <= this.now() + 60_000) {
        const refreshed = await this.client.refresh(account.refreshToken);
        account = { ...account, ...refreshed } satisfies StoredAccount;
        await this.store.save(account);
      }
      await this.client.upsertInstall(account, {
        user_id: account.userId, device_id: account.deviceId, app_version: this.version,
        os: 'windows', last_seen: new Date(this.now()).toISOString(),
      });
      this.lastSent = this.now();
      this.logged = false;
    } catch {
      if (!this.logged) { this.log('[account] heartbeat failed'); this.logged = true; }
    }
  }
}
