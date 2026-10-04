import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { safePath } from '../src/main/connectors/fs/safePath';

describe('safePath (A1)', () => {
  let fixture: string;
  let downloads: string;
  let documents: string;
  beforeEach(async () => {
    fixture = await fs.mkdtemp(path.join(os.tmpdir(), 'ade-safe-'));
    downloads = path.join(fixture, 'Downloads');
    documents = path.join(fixture, 'Documents');
    await Promise.all([fs.mkdir(downloads), fs.mkdir(documents), fs.mkdir(path.join(fixture, 'Downloads2'))]);
  });
  afterEach(async () => { await fs.rm(fixture, { recursive: true, force: true }); });

  it('accepts existing and future files in a named root, including ADE Trash', async () => {
    await fs.writeFile(path.join(downloads, 'notes.txt'), 'fixture');
    const options = { allowedRoots: [downloads], documentsRoot: documents };
    expect(await safePath('Downloads/notes.txt', options)).toMatchObject({ ok: true, abs: path.join(downloads, 'notes.txt') });
    expect(await safePath(path.join(downloads, 'new', 'later.txt'), options)).toMatchObject({ ok: true });
    expect(await safePath(path.join(documents, 'ADE Trash', 'batch', 'old.txt'), options)).toMatchObject({ ok: true });
  });

  it('rejects malicious Windows spellings and excluded components', async () => {
    const options = { allowedRoots: [downloads] };
    for (const bad of ['', '\\\\server\\share\\file', '\\\\?\\C:\\file', '\\\\.\\C:\\file',
      'Downloads/file.txt:stream', 'Downloads/CON.txt', 'Downloads/COM1', 'Downloads/../Downloads2/secret.txt',
      path.join(fixture, 'Downloads2', 'secret.txt'), 'Downloads/.git/config', 'Downloads/node_modules/pkg',
      'Downloads/desktop.ini', 'Downloads/thumbs.db']) {
      expect((await safePath(bad, options)).ok, bad).toBe(false);
    }
  });

  it('rejects a symlink that leaves the allowed root', async () => {
    const outside = path.join(fixture, 'outside');
    await fs.mkdir(outside);
    await fs.symlink(outside, path.join(downloads, 'linked'), 'junction');
    expect(await safePath(path.join(downloads, 'linked', 'future.txt'), { allowedRoots: [downloads] }))
      .toMatchObject({ ok: false, reason: 'OUTSIDE_ALLOWED_FOLDERS' });
  });
});
