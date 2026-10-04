import { describe, expect, it, vi } from 'vitest';
import { TigerResearchStore } from '../src/main/store/tigerResearch';
import type { Db } from '../src/main/store/tiger';

describe('TigerResearchStore', () => {
  it('records Scout findings and briefs with the research log schema', async () => {
    const query = vi.fn(async () => ({ rows: [] }));
    const store = new TigerResearchStore({ query } as Db);
    await store.record('Laptop research', ['Good battery life: https://example.com'], 'C:/ADE Research/laptops.md');
    expect(query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO research_log'),
      [expect.any(String), expect.any(Date), 'Laptop research', JSON.stringify(['Good battery life: https://example.com']), 'C:/ADE Research/laptops.md']);
  });

  it('keeps findings available when Tiger is offline', async () => {
    const store = new TigerResearchStore({ query: async () => { throw new Error('offline'); } }, () => {});
    await store.record('Laptops', ['Finding with source']);
    expect(await store.find(new Date(Date.now() - 1000), 'laptop')).toEqual([expect.objectContaining({ title: 'Laptops', sources: ['Finding with source'] })]);
  });
});
