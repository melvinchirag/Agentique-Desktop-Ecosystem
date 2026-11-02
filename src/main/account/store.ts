import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { adeDataDir } from '../store/tiger';
import type { SafeStorageLike } from '../connectors/google/tokenStore';
import type { Session } from './supabase';

export interface StoredAccount extends Session { email: string; deviceId: string }

export class AccountStore {
  constructor(private readonly storage: SafeStorageLike, private readonly file = join(adeDataDir(), 'account.json'),
    private readonly dev = false) {}

  async load(): Promise<StoredAccount | null> {
    let raw: string;
    try { raw = await readFile(this.file, 'utf8'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
    const envelope = JSON.parse(raw) as { encrypted?: string; account?: StoredAccount };
    const value = envelope.encrypted
      ? JSON.parse(this.storage.decryptString(Buffer.from(envelope.encrypted, 'base64'))) as StoredAccount
      : envelope.account;
    if (!value || typeof value.userId !== 'string' || typeof value.email !== 'string' ||
      typeof value.accessToken !== 'string' || typeof value.refreshToken !== 'string' ||
      typeof value.expiresAt !== 'number' || typeof value.deviceId !== 'string') return null;
    return value;
  }

  async save(account: StoredAccount): Promise<void> {
    const envelope = this.storage.isEncryptionAvailable()
      ? { encrypted: this.storage.encryptString(JSON.stringify(account)).toString('base64') }
      : { account };
    if (!this.storage.isEncryptionAvailable() && this.dev) console.warn('[account] safeStorage unavailable; account stored as plain JSON');
    await mkdir(dirname(this.file), { recursive: true });
    const temp = `${this.file}.${randomUUID()}.tmp`;
    try { await writeFile(temp, JSON.stringify(envelope), { mode: 0o600 }); await rename(temp, this.file); }
    finally { await rm(temp, { force: true }); }
  }

  /** Stable across sign-out so signing in again does not count the same installation twice. */
  async deviceId(): Promise<string> {
    const file = join(dirname(this.file), 'account-device-id');
    try {
      const id = (await readFile(file, 'utf8')).trim();
      if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return id;
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    const previous = (await this.load().catch(() => null))?.deviceId;
    const id = previous && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(previous)
      ? previous : randomUUID();
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, id, { mode: 0o600 });
    return id;
  }

  async clear(): Promise<void> { await rm(this.file, { force: true }); }
}
