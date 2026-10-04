import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { FileIndex } from '../src/main/connectors/fs/fileIndex';
import { FakeClock } from '../src/main/runtime/clock';

describe('FileIndex', () => {
  let fixture: string;
  let downloads: string;
  let documents: string;
  const clock = new FakeClock(Date.UTC(2026, 9, 4));
  beforeEach(async () => {
    fixture = await fs.mkdtemp(path.join(os.tmpdir(), 'ade-index-'));
    downloads = path.join(fixture, 'Downloads');
    documents = path.join(fixture, 'Documents');
    await Promise.all([fs.mkdir(downloads), fs.mkdir(documents)]);
  });
  afterEach(async () => { await fs.rm(fixture, { recursive: true, force: true }); });
  const write = async (file: string, ageDays = 0) => {
    await fs.writeFile(file, 'fixture');
    const date = new Date(clock.now() - ageDays * 86_400_000);
    await fs.utimes(file, date, date);
  };

  it('ranks name matches, filters extension and age, and excludes Trash and .git', async () => {
    await fs.mkdir(path.join(downloads, '.git'));
    await fs.mkdir(path.join(documents, 'ADE Trash'));
    await write(path.join(downloads, 'resume.pdf'), 1);
    await write(path.join(downloads, 'resume-old.pdf'), 20);
    await write(path.join(downloads, 'resume.docx'), 0);
    await write(path.join(downloads, '.git', 'resume.pdf'));
    await write(path.join(documents, 'ADE Trash', 'resume.pdf'));
    const index = new FileIndex({ allowedRoots: [downloads, documents], documentsRoot: documents, clock });
    await index.build();
    expect(index.search('resume').map((e) => e.name)).toEqual(['resume.docx', 'resume.pdf', 'resume-old.pdf']);
    expect(index.search('resume', { ext: 'pdf', modifiedWithinDays: 7 }).map((e) => e.name)).toEqual(['resume.pdf']);
    expect(index.search('resume', { folder: documents })).toEqual([]);
    index.stopWatching();
  });

  it('updates immediately for create, move and remove operations', async () => {
    const index = new FileIndex({ allowedRoots: [downloads], clock });
    await index.build();
    const first = path.join(downloads, 'draft.txt');
    const second = path.join(downloads, 'final.txt');
    await write(first);
    await index.update(first);
    expect(index.search('draft')).toHaveLength(1);
    await fs.rename(first, second);
    await index.move(first, second);
    expect(index.search('draft')).toHaveLength(0);
    expect(index.search('final')).toHaveLength(1);
    await fs.unlink(second);
    index.remove(second);
    expect(index.size).toBe(0);
  });

  it('honors depth and entry caps', async () => {
    await write(path.join(downloads, 'one.txt'));
    await write(path.join(downloads, 'two.txt'));
    const index = new FileIndex({ allowedRoots: [downloads], clock, maxEntries: 1 });
    await index.build();
    expect(index.size).toBe(1);
  });

  it('a folder change re-scans only that folder: the index stays ready and keeps its other entries', async () => {
    const index = new FileIndex({ allowedRoots: [downloads], clock });
    await write(path.join(downloads, 'keep-me.pdf'));
    await index.build();
    expect(index.search('keep-me')).toHaveLength(1);

    const folder = path.join(downloads, 'new-folder');
    await fs.mkdir(folder);
    await write(path.join(folder, 'inside.pdf'));
    const before = index.size;
    let readyDuring = true;
    const watch = setInterval(() => { readyDuring &&= index.isReady; }, 0);
    index.notifyChanged(folder);
    clock.advance(500);
    await vi.waitFor(() => expect(index.search('inside')).toHaveLength(1));
    clearInterval(watch);

    expect(readyDuring).toBe(true);                                          // never flipped to not-ready
    expect(index.search('keep-me')).toHaveLength(1);                         // untouched entries survived
    expect(index.size).toBe(before + 1);
  });

  it('a removed folder drops its files without a rebuild', async () => {
    const folder = path.join(downloads, 'gone');
    await fs.mkdir(folder);
    await write(path.join(folder, 'old.pdf'));
    await write(path.join(downloads, 'stay.pdf'));
    const index = new FileIndex({ allowedRoots: [downloads], clock });
    await index.build();
    expect(index.search('old')).toHaveLength(1);
    await fs.rm(folder, { recursive: true });
    index.notifyChanged(folder);
    clock.advance(500);
    await vi.waitFor(() => expect(index.search('old')).toHaveLength(0));
    expect(index.search('stay')).toHaveLength(1);
    expect(index.isReady).toBe(true);
  });

  it('debounces watcher notifications and refreshes changed files', async () => {
    const index = new FileIndex({ allowedRoots: [downloads], clock });
    await index.build();
    const file = path.join(downloads, 'watched.pdf');
    await write(file);
    index.notifyChanged(file);
    clock.advance(300);
    index.notifyChanged(file);
    clock.advance(499);
    expect(index.search('watched')).toHaveLength(0);
    clock.advance(1);
    await vi.waitFor(() => expect(index.search('watched')).toHaveLength(1));
    await fs.unlink(file);
    index.notifyChanged(file);
    clock.advance(500);
    await vi.waitFor(() => expect(index.search('watched')).toHaveLength(0));
  });
});
