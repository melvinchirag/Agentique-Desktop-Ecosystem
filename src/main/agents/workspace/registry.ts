import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';

export type RegistryRow = {
  kind: 'draft' | 'doc'; id: string; threadId?: string; messageId?: string;
  createdAt: number; toCount?: number; subject?: string; title?: string;
  state: 'waiting' | 'sent' | 'deleted';
};

export function registryLabel(value: string): string {
  return value.replace(/[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[address]').slice(0, 120);
}

export function adeDataDir(env: NodeJS.ProcessEnv = process.env): string {
  return env.APPDATA ? join(env.APPDATA, 'ADE') : join(homedir(), '.ade');
}

/** Local ownership is authoritative. Each change adds a row; no old row is rewritten. */
export class PixelRegistry {
  private queue: Promise<unknown> = Promise.resolve();
  constructor(readonly filename = join(adeDataDir(), 'pixel-registry.jsonl')) {}

  async record(row: RegistryRow): Promise<void> {
    const safe: RegistryRow = {
      kind: row.kind, id: row.id, createdAt: row.createdAt, state: row.state,
      ...(row.threadId ? { threadId: row.threadId } : {}),
      ...(row.messageId ? { messageId: row.messageId } : {}),
      ...(row.toCount !== undefined ? { toCount: row.toCount } : {}),
      ...(row.subject ? { subject: registryLabel(row.subject) } : {}),
      ...(row.title ? { title: registryLabel(row.title) } : {}),
    };
    const write = this.queue.then(async () => {
      await mkdir(join(this.filename, '..'), { recursive: true });
      await appendFile(this.filename, `${JSON.stringify(safe)}\n`, 'utf8');
    });
    this.queue = write.catch(() => undefined);
    await write;
  }

  async all(): Promise<RegistryRow[]> {
    await this.queue;
    let contents: string;
    try { contents = await readFile(this.filename, 'utf8'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
    const latest = new Map<string, RegistryRow>();
    for (const line of contents.split('\n')) {
      if (!line) continue;
      const row = JSON.parse(line) as RegistryRow;
      if (row.kind !== 'draft' && row.kind !== 'doc') continue;
      if (typeof row.id !== 'string' || !row.id) continue;
      latest.set(`${row.kind}:${row.id}`, row);
    }
    return [...latest.values()];
  }

  async get(kind: RegistryRow['kind'], id: string): Promise<RegistryRow | undefined> {
    return (await this.all()).find(row => row.kind === kind && row.id === id);
  }

  async setState(kind: RegistryRow['kind'], id: string, state: RegistryRow['state']): Promise<boolean> {
    const row = await this.get(kind, id);
    if (!row) return false;
    await this.record({ ...row, state });
    return true;
  }
}
