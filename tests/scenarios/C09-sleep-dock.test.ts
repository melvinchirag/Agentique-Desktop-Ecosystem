import { describe, expect, it } from 'vitest';
import { HOUR, makeRig, SEC } from './helpers';

describe('C9 fast-forward sleepAfter, then dockAfter', () => {
  it('active → sleeping at sleepAfterSec → docked at dockAfterSec more; Chip sleeps but never docks', async () => {
    const t = makeRig();                                                // default timers: sleep 180 s, dock 600 s
    const specialists = ['workspace', 'wolf', 'beaver', 'eagle', 'ants'] as const;
    expect(t.chip.presence.get('eagle')).toBe('active');
    expect(t.presenceEvents('eagle').map((e) => [e.presence, e.reason])).toEqual([['active', 'startup']]);

    await t.advance(180 * SEC - 1);
    expect(t.chip.presence.get('eagle')).toBe('active');                // not yet
    await t.advance(1);
    for (const id of specialists) expect(t.chip.presence.get(id)).toBe('sleeping');
    expect(t.chip.presence.get('chipmunk')).toBe('sleeping');
    const slept = t.presenceEvents('eagle').find((e) => e.presence === 'sleeping')!;
    expect(slept.reason).toBe('idle_timeout');
    expect(t.at(slept)).toBe(180);

    await t.advance(600 * SEC - 1);
    expect(t.chip.presence.get('eagle')).toBe('sleeping');              // asleep, not yet docked
    await t.advance(1);
    for (const id of specialists) expect(t.chip.presence.get(id)).toBe('docked');
    const docked = t.presenceEvents('eagle').find((e) => e.presence === 'docked')!;
    expect(docked.reason).toBe('dock_timeout');
    expect(t.at(docked)).toBe(780);
    expect(t.presenceEvents('eagle').map((e) => e.presence)).toEqual(['active', 'sleeping', 'docked']);

    // Chip never docks, however long it sleeps. Animals that aren't installed never show up at all.
    await t.advance(2 * HOUR);
    expect(t.chip.presence.get('chipmunk')).toBe('sleeping');
    expect(t.presenceEvents('chipmunk').map((e) => e.presence)).toEqual(['active', 'sleeping']);
    expect(t.presenceEvents('butterfly')).toHaveLength(0);
    expect(t.chip.presence.get('butterfly')).toBe('not_installed');
  });
});
