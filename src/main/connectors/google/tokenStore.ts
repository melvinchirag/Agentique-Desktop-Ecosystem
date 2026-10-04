import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

/** Only long-lived credentials are stored. Access tokens remain in GoogleAuthService memory. */
export interface StoredGoogleTokens { refreshToken: string; scopes: string[] }
export interface TokenStore {
  load(): Promise<StoredGoogleTokens | null>;
  save(tokens: StoredGoogleTokens): Promise<void>;
  clear(): Promise<void>;
}

function validated(value: unknown): StoredGoogleTokens | null {
  if (!value || typeof value !== 'object') return null;
  const input = value as Record<string, unknown>;
  if (typeof input.refreshToken !== 'string' || !input.refreshToken ||
      !Array.isArray(input.scopes) || !input.scopes.every(s => typeof s === 'string')) return null;
  return { refreshToken: input.refreshToken, scopes: [...input.scopes] as string[] };
}

export class MemoryTokenStore implements TokenStore {
  private tokens: StoredGoogleTokens | null = null;
  async load(): Promise<StoredGoogleTokens | null> {
    return this.tokens ? { refreshToken: this.tokens.refreshToken, scopes: [...this.tokens.scopes] } : null;
  }
  async save(tokens: StoredGoogleTokens): Promise<void> {
    this.tokens = validated(tokens);
    if (!this.tokens) throw new Error('Invalid Google tokens');
  }
  async clear(): Promise<void> { this.tokens = null; }
}

export interface SafeStorageLike {
  isEncryptionAvailable(): boolean;
  encryptString(plainText: string): Buffer;
  decryptString(encrypted: Buffer): string;
}

/** Defaults to %APPDATA%/ADE/google-tokens.bin on Windows. */
export class SafeStorageTokenStore implements TokenStore {
  private readonly fallback = new MemoryTokenStore();
  private readonly filePath: string;
  constructor(private readonly safeStorage: SafeStorageLike, filePath = join(
    process.env.APPDATA ?? (process.platform === 'win32' ? join(homedir(), 'AppData', 'Roaming') : join(homedir(), '.config')),
    'ADE', 'google-tokens.bin',
  )) {
    this.filePath = filePath;
  }
  async load(): Promise<StoredGoogleTokens | null> {
    if (!this.safeStorage.isEncryptionAvailable()) return this.fallback.load();
    try {
      const bytes = await readFile(this.filePath);
      return validated(JSON.parse(this.safeStorage.decryptString(bytes)));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }
  async save(tokens: StoredGoogleTokens): Promise<void> {
    const value = validated(tokens);
    if (!value) throw new Error('Invalid Google tokens');
    if (!this.safeStorage.isEncryptionAvailable()) {
      await this.fallback.save(value);
      return;
    }
    const encrypted = this.safeStorage.encryptString(JSON.stringify(value));
    await mkdir(dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, encrypted, { mode: 0o600 });
  }
  async clear(): Promise<void> {
    await this.fallback.clear();
    await rm(this.filePath, { force: true });
  }
}

/** Explicitly dev-only plaintext refresh-token storage. The repository ignores .ade-dev/. */
export class DevFileTokenStore implements TokenStore {
  private readonly filePath: string;
  constructor(options: { projectRoot?: string; isPackaged: boolean }) {
    if (options.isPackaged) throw new Error('DevFileTokenStore cannot run in a packaged app');
    this.filePath = join(resolve(options.projectRoot ?? process.cwd()), '.ade-dev', 'google-tokens.json');
  }
  async load(): Promise<StoredGoogleTokens | null> {
    try { return validated(JSON.parse(await readFile(this.filePath, 'utf8'))); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }
  async save(tokens: StoredGoogleTokens): Promise<void> {
    const value = validated(tokens);
    if (!value) throw new Error('Invalid Google tokens');
    await mkdir(dirname(this.filePath), { recursive: true, mode: 0o700 });
    await writeFile(this.filePath, JSON.stringify(value), { mode: 0o600 });
  }
  async clear(): Promise<void> { await rm(this.filePath, { force: true }); }
}
