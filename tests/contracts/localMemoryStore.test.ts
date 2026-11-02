import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LocalMemoryStore } from '../../src/main/memory/localMemoryStore';
import { memoryStoreContract } from './memoryStore.contract';

const freshFile = () => join(mkdtempSync(join(tmpdir(), 'ade-mem-')), 'memories.json');

memoryStoreContract('LocalMemoryStore (JSON file)', (now) => new LocalMemoryStore(freshFile(), now));

describe('LocalMemoryStore persistence', () => {
  it('survives a restart: a new instance on the same file sees the same rows, and the file is versioned JSON', async () => {
    const file = freshFile();
    const a = new LocalMemoryStore(file);
    const { id } = await a.add('chipmunk', 'Studies best before noon');
    await a.add('beaver', 'Class notes go in Documents/EMU');
    const b = new LocalMemoryStore(file);
    expect((await b.list('chipmunk')).map((m) => m.id)).toEqual([id]);
    expect(await b.list('beaver')).toHaveLength(1);
    const raw = JSON.parse(readFileSync(file, 'utf8'));
    expect(raw.version).toBe(1);
    expect(Object.keys(raw.agents).sort()).toEqual(['beaver', 'chipmunk']);
  });

  it('imports an export keeping ids and timestamps, skips duplicates, and starts empty on a corrupt file', async () => {
    const file = freshFile();
    const store = new LocalMemoryStore(file);
    const rows = [
      { id: 'bb-1', content: 'Name is Sam', created_at: '2026-10-04T01:00:00.000Z', updated_at: '2026-10-04T01:00:00.000Z' },
      { id: 'bb-2', content: 'name is sam', created_at: '2026-10-04T01:00:00.000Z' },
    ];
    expect(await store.importRows('chipmunk', rows)).toEqual({ added: 1, skipped: 1 });
    const got = await store.list('chipmunk');
    expect(got[0]).toMatchObject({ id: 'bb-1', created_at: '2026-10-04T01:00:00.000Z' });
    writeFileSync(file, '{ not json');
    const again = new LocalMemoryStore(file);
    expect(await again.list('chipmunk')).toEqual([]);
    await again.add('chipmunk', 'fresh start');
    expect(JSON.parse(readFileSync(file, 'utf8')).agents.chipmunk).toHaveLength(1);
  });
});
