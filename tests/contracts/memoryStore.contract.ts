// Contract suite for MemoryApi + MemoryWriter + RecallProvider. Runs unchanged against the in-memory
// store and LocalMemoryStore (W3). `make(clock)` receives a clock so timestamps are deterministic.
import { describe, expect, it } from 'vitest';
import type { RecallProvider } from '../../src/main/runtime/recall';
import type { MemoryApi, MemoryWriter } from '../../src/main/runtime/types';

export type MemoryStoreUnderTest = MemoryApi & MemoryWriter & RecallProvider;

export function memoryStoreContract(name: string, make: (now: () => number) => MemoryStoreUnderTest | Promise<MemoryStoreUnderTest>): void {
  describe(`MemoryStore contract: ${name}`, () => {
    const clock = () => { let t = 1_700_000_000_000; return { now: () => t, tick: (ms = 1000) => { t += ms; } }; };

    it('add, list, update, remove: per-agent isolation, ISO timestamps, newest first', async () => {
      const c = clock();
      const store = await make(c.now);
      const { id } = await store.add('chipmunk', 'Studies best before noon');
      c.tick();
      await store.add('chipmunk', 'Likes short email replies');
      await store.add('beaver', 'Keeps Downloads tidy on Fridays');
      const chip = await store.list('chipmunk');
      expect(chip.map((m) => m.content)).toEqual(['Likes short email replies', 'Studies best before noon']);
      expect(chip[0]!.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(await store.list('beaver')).toHaveLength(1);
      expect(await store.list('wolf')).toEqual([]);
      c.tick();
      await store.update('chipmunk', id, 'Studies best in the morning');
      const after = (await store.list('chipmunk')).find((m) => m.id === id)!;
      expect(after.content).toBe('Studies best in the morning');
      expect(after.updated_at! > after.created_at!).toBe(true);
      await store.remove('chipmunk', id);
      expect((await store.list('chipmunk')).map((m) => m.id)).not.toContain(id);
      await store.remove('chipmunk', id); // no-op
    });

    it('search ranks by keyword hits, ignores short words, and never crosses agents', async () => {
      const store = await make(clock().now);
      await store.add('chipmunk', 'CS 280 midterm is on Thursday');
      await store.add('chipmunk', 'Thursday is the gym day');
      await store.add('chipmunk', 'Prefers tea over coffee');
      await store.add('beaver', 'Thursday backup of the Desktop');
      const hits = await store.search('chipmunk', 'what is on Thursday, the midterm?');
      expect(hits[0]!.content).toBe('CS 280 midterm is on Thursday');  // two hits: thursday, midterm
      expect(hits.map((m) => m.content)).not.toContain('Prefers tea over coffee');
      expect(hits.map((m) => m.content)).not.toContain('Thursday backup of the Desktop');
      expect(await store.search('chipmunk', 'is on')).toEqual([]);     // only words under 3 chars
    });

    it('search returns at most 20 rows', async () => {
      const store = await make(clock().now);
      for (let i = 0; i < 25; i++) await store.add('chipmunk', `project note ${i}`);
      expect(await store.search('chipmunk', 'project')).toHaveLength(20);
    });

    it('recall returns keyword hits first, fills with the most recent, and respects k', async () => {
      const c = clock();
      const store = await make(c.now);
      await store.add('chipmunk', 'Oldest fact about nothing in particular'); c.tick();
      await store.add('chipmunk', 'Midterm review moved to Thursday'); c.tick();
      await store.add('chipmunk', 'Newest fact about the weekend'); c.tick();
      const r = await store.recall('chipmunk', 'how did the midterm go', 2);
      expect(r).toHaveLength(2);
      expect(r[0]!.content).toBe('Midterm review moved to Thursday');
      expect(r[1]!.content).toBe('Newest fact about the weekend');
      expect(await store.recall('chipmunk', 'anything', 10)).toHaveLength(3);
      expect(await store.recall('wolf', 'anything')).toEqual([]);
    });
  });
}
