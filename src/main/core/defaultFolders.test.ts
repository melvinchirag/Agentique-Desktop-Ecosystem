import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { defaultFolders } from './defaultFolders';

describe('defaultFolders', () => {
  it('includes Electron known folders and existing OneDrive and local counterparts', async () => {
    const home = await mkdtemp(join(tmpdir(), 'ade-folders-'));
    try {
      const oneDrive = join(home, 'OneDrive');
      for (const folder of ['Desktop', 'Documents', 'Downloads']) {
        await mkdir(join(home, folder));
        await mkdir(join(oneDrive, folder), { recursive: true });
      }
      const folders = defaultFolders({ home, oneDrive, desktop: join(oneDrive, 'Desktop'),
        documents: join(oneDrive, 'Documents'), downloads: join(home, 'Downloads') });
      expect(folders.allowed).toEqual([
        join(oneDrive, 'Desktop'), join(home, 'Desktop'),
        join(oneDrive, 'Documents'), join(home, 'Documents'),
        join(home, 'Downloads'), join(oneDrive, 'Downloads'),
      ]);
      expect(folders.documentsRoot).toBe(join(oneDrive, 'Documents'));
    } finally { await rm(home, { recursive: true, force: true }); }
  });
});
