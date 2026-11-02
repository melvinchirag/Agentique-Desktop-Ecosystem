import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BackboardClient } from '../runtime/backboard';
import { readEnvFile } from '../sponsors/env';
import { saveSetupKeys, writeSetupEnv } from './envFile';
import { createMissingAssistants, verifyBackboardKey } from './setupService';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

describe('Backboard setup', () => {
  it('handles a live balance, rejected key, and network failure', async () => {
    const success = vi.fn(async () => new Response(JSON.stringify({ balance_usd: 4.25 }), { status: 200 }));
    expect(await verifyBackboardKey('sample', success as typeof fetch)).toEqual({ status: 'connected', balance: 4.25 });
    expect(success).toHaveBeenCalledWith('https://app.backboard.io/api/billing/balance', expect.objectContaining({ headers: { 'X-API-Key': 'sample' } }));
    expect(await verifyBackboardKey('sample', async () => new Response('', { status: 401 }))).toEqual({ status: 'rejected' });
    expect(await verifyBackboardKey('sample', async () => { throw new Error('offline'); })).toEqual({ status: 'unreachable' });
  });
  it('creates only missing assistants over HTTP and persists each id', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ade-assistants-')); roots.push(root);
    const file = join(root, '.env');
    saveSetupKeys(file, 'sample');
    writeSetupEnv(file, { BB_ASSISTANT_CHIPMUNK: 'existing' });
    let count = 0;
    const fetchFn = vi.fn(async (_url: string, options: RequestInit) => {
      expect(options.method).toBe('POST');
      count++;
      return new Response(JSON.stringify({ assistant_id: `id-${count}` }), { status: 200 });
    });
    const progress: string[] = [];
    const client = new BackboardClient({ apiKey: 'sample', fetch: fetchFn as typeof fetch });
    await createMissingAssistants(file, client, message => progress.push(message), { BB_ASSISTANT_WOLF: 'from-higher-priority-source' });
    expect(fetchFn).toHaveBeenCalledTimes(7);
    expect(readEnvFile(file)).toMatchObject({ BB_ASSISTANT_CHIPMUNK: 'existing', BB_ASSISTANT_WORKSPACE: 'id-1', BB_ASSISTANT_WOLF: 'from-higher-priority-source', BB_ASSISTANT_WARDEN_SCREEN: 'id-7' });
    expect(progress).toContain('Chip: already set up');
    await createMissingAssistants(file, client, () => undefined);
    expect(fetchFn).toHaveBeenCalledTimes(7);
  });
});
