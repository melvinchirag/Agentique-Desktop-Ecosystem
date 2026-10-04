import { describe, expect, it } from 'vitest';
import { createRealCore, missingRealCoreKeys } from './realCore';

describe('real core startup fallback', () => {
  it('requires the Chip and Tiger credentials but treats voice as optional', () => {
    expect(missingRealCoreKeys({})).toEqual(['BACKBOARD_API_KEY', 'BB_ASSISTANT_CHIPMUNK', 'TIGER_DATABASE_URL']);
    expect(missingRealCoreKeys({ BACKBOARD_API_KEY: 'bb', BB_ASSISTANT_CHIPMUNK: 'chip', TIGER_DATABASE_URL: 'postgres://user:pass@example/db' })).toEqual([]);
    expect(missingRealCoreKeys({ BACKBOARD_API_KEY: 'bb', BB_ASSISTANT_CHIPMUNK: 'chip', TIGER_DATABASE_URL: 'postgres://user@example/db' })).toEqual(['TIGER_DATABASE_URL credentials']);
  });

  it('keeps --demo on FakeCore and warns in the Hub when normal startup lacks keys', async () => {
    const demo = createRealCore({ demoMode: true, env: {} });
    const demoEvents: string[] = [];
    demo.subscribe(event => { if (event.type === 'wolf.alert') demoEvents.push(event.reason); });
    demo.start?.();
    expect((await demo.getSettings()).demoMode).toBe(true);
    expect(demoEvents).toEqual([]);
    demo.dispose?.();

    const fallback = createRealCore({ env: {} });
    const warnings: string[] = [];
    fallback.subscribe(event => { if (event.type === 'wolf.alert') warnings.push(event.reason); });
    fallback.start?.();
    expect((await fallback.getSettings()).demoMode).toBe(true);
    expect(warnings).toEqual(['Running demo core: missing keys']);
    expect(await fallback.getMemories('chipmunk')).toEqual([]);
    expect(await fallback.searchMemories('chipmunk', 'sample')).toEqual([]);
    fallback.dispose?.();
  });
});
