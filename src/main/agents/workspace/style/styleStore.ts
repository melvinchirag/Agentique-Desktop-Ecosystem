import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import type { MemoryApi, MemoryWriter } from '../../../runtime/types';
import { compactStyle } from './compact';
import type { StyleProfile } from './types';

const PREFIX = 'User email style:';

export class StyleStore {
  readonly path: string;
  constructor(private readonly memory: MemoryApi, private readonly writer: MemoryWriter, path?: string) {
    this.path = path ?? join(process.env.APPDATA || join(homedir(), '.config'), 'ADE', 'pixel-style.json');
  }

  async get(): Promise<StyleProfile | null> {
    try {
      const profile: unknown = JSON.parse(await readFile(this.path, 'utf8'));
      if (!profile || typeof profile !== 'object' || !('version' in profile) || profile.version !== 1) return null;
      return profile as StyleProfile;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }

  async save(profile: StyleProfile): Promise<void> {
    const mirror = compactStyle(profile);
    const existing = (await this.memory.list('workspace')).filter(item => item.content.startsWith(PREFIX));
    if (existing[0]) await this.memory.update('workspace', existing[0].id, mirror);
    else await this.writer.add('workspace', mirror);
    for (const duplicate of existing.slice(1)) await this.memory.remove('workspace', duplicate.id);
    await mkdir(dirname(this.path), { recursive: true });
    const temporary = `${this.path}.tmp`;
    try {
      await writeFile(temporary, JSON.stringify(profile), { encoding: 'utf8', mode: 0o600 });
      await rename(temporary, this.path);
    } finally {
      await rm(temporary, { force: true });
    }
  }

  /** Call at startup once remote memory is reachable. A deleted mirror erases the cache. */
  async sync(): Promise<StyleProfile | null> {
    const profile = await this.get();
    if (!profile) return null;
    const mirrors = (await this.memory.list('workspace')).filter(item => item.content.startsWith(PREFIX));
    if (mirrors.length === 0) {
      await rm(this.path, { force: true });
      return null;
    }
    return profile;
  }
}
