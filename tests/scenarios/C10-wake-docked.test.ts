import { describe, expect, it } from 'vitest';
import { WAKE_FROM_DOCK_MS } from '../../src/main/runtime/presence';
import { delegate, makeRig, mood, outputOf, SEC, say, silent, tools } from './helpers';

describe('C10 delegate to docked Swarm', () => {
  it('woke_and_started: Swarm returns from the Hub first, then the job starts', async () => {
    const t = makeRig({
      script: [tools(mood('calm'), delegate('ants', 'Plan the week')), silent(), say('Planned 🐜', 'Swarm mapped out your week.')],
    });
    await t.advance((180 + 600) * SEC);                                 // everyone asleep, then docked
    expect(t.chip.presence.get('ants')).toBe('docked');
    expect(t.chip.presence.get('chipmunk')).toBe('sleeping');

    const askedAt = t.clock.now();
    t.chip.orchestrator.submitUserMessage('plan my week');
    await t.advance(0);

    expect(outputOf(t.toolOutputs()[0], 1)).toMatchObject({ status: 'woke_and_started' });
    expect(t.chipSays('ack')).toEqual([expect.objectContaining({ text: 'Swarm, assemble!', bubble: 'Swarm 🐜' })]);

    // Swarm is back in the biome (reason 'job') right away; the job only starts when it has walked back.
    const back = t.presenceEvents('ants').find((e) => e.presence === 'active' && e.reason === 'job')!;
    expect(back.ts).toBe(askedAt);
    expect(t.specialists.runs.filter((r) => r.agentId === 'ants')).toHaveLength(0);
    expect(t.jobUpdates('ants')).toHaveLength(0);

    await t.advance(WAKE_FROM_DOCK_MS - 1);
    expect(t.specialists.runs.filter((r) => r.agentId === 'ants')).toHaveLength(0);
    await t.advance(1);
    expect(t.specialists.runs.filter((r) => r.agentId === 'ants')).toHaveLength(1);
    const running = t.jobUpdates('ants')[0]!;
    expect(running).toMatchObject({ state: 'running', title: 'Plan the week' });
    expect(running.ts - back.ts).toBe(WAKE_FROM_DOCK_MS);
    expect(t.handoffs()).toEqual([expect.objectContaining({ to: 'ants', task: 'Plan the week' })]);
    expect(t.indexOf((e) => e.type === 'agent.presence' && e.agentId === 'ants' && e.presence === 'active'))
      .toBeLessThan(t.indexOf((e) => e.type === 'job.update' && e.to === 'ants'));

    await t.advance(3 * SEC + 1500);
    expect(t.jobUpdates('ants').map((e) => e.state)).toEqual(['running', 'done']);
    expect(t.chipSays('chip').map((e) => e.text)).toEqual(['Swarm mapped out your week.']);
  });
});
