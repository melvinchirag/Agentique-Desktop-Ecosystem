import { describe, expect, it, vi } from 'vitest';

const files = new Map<string, string>();
vi.mock('node:fs/promises', () => ({
  mkdir: vi.fn(async () => undefined),
  readFile: vi.fn(async (file: string) => {
    if (!files.has(file)) throw Object.assign(new Error('missing'), { code: 'ENOENT' });
    return files.get(file);
  }),
  writeFile: vi.fn(async (file: string, value: string) => { files.set(file, value); }),
  rename: vi.fn(async (from: string, to: string) => { files.set(to, files.get(from)!); files.delete(from); }),
  rm: vi.fn(async (file: string) => { files.delete(file); }),
}));

import { AccountStore } from './store';

describe('account store', () => {
  it('encrypts and decrypts the complete session and clears it', async () => {
    const storage = {
      isEncryptionAvailable: () => true,
      encryptString: vi.fn((plain: string) => Buffer.from(`encrypted:${plain}`)),
      decryptString: vi.fn((bytes: Buffer) => bytes.toString().slice('encrypted:'.length)),
    };
    const store = new AccountStore(storage, 'C:/test/ADE/account.json');
    const account = { userId: 'user-id', email: 'person@example.com', accessToken: 'access', refreshToken: 'refresh', expiresAt: 1234, deviceId: 'device-id' };
    await store.save(account);
    expect(files.get('C:/test/ADE/account.json')).not.toContain('person@example.com');
    expect(files.get('C:/test/ADE/account.json')).not.toContain('refresh');
    expect(await store.load()).toEqual(account);
    expect(storage.encryptString).toHaveBeenCalledOnce();
    expect(storage.decryptString).toHaveBeenCalledOnce();
    await store.clear();
    expect(await store.load()).toBeNull();
  });
  it('uses plain JSON only when encryption is unavailable and warns in development', async () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const storage = { isEncryptionAvailable: () => false, encryptString: vi.fn(), decryptString: vi.fn() };
    const store = new AccountStore(storage, 'C:/test/ADE/plain-account.json', true);
    const account = { userId: 'user-id', email: 'person@example.com', accessToken: 'access', refreshToken: 'refresh', expiresAt: 1234, deviceId: 'device-id' };
    await store.save(account);
    expect(await store.load()).toEqual(account);
    expect(warning).toHaveBeenCalledOnce();
    expect(warning.mock.calls[0][0]).not.toContain('person@example.com');
    warning.mockRestore();
    await store.clear();
  });
  it('keeps the installation ID after the account file is cleared', async () => {
    const storage = { isEncryptionAvailable: () => true, encryptString: vi.fn(), decryptString: vi.fn() };
    const store = new AccountStore(storage, 'C:/test/ADE/relogin/account.json');
    const id = await store.deviceId();
    expect(id).toMatch(/^[0-9a-f-]{36}$/i);
    await store.clear();
    expect(await store.deviceId()).toBe(id);
    files.delete('C:/test/ADE/relogin/account-device-id');
  });
});
