import { describe, expect, it } from 'vitest';
import { delegate, makeRig, mood, SEC, say, silent, tools } from './helpers';

describe('C3 pizza running, then "check my email"', () => {
  it('Pixel starts immediately while Scout continues', async () => {
    const t = makeRig({
      delayMs: { eagle: 10 * SEC, workspace: 3 * SEC },
      script: [
        tools(mood('calm'), delegate('eagle', 'Pizza near campus')),
        silent(),
        tools(mood('calm'), delegate('workspace', "Today's inbox")),
        silent(),
        say('5 emails 📬', 'Five emails today.'),                     // Pixel's result turn (t = 5 s + 1.5 s)
        say('Pizza 🍕', "Tony's is closest."),                       // Scout's result turn
      ],
    });

    await t.user('find pizza near campus');
    await t.advance(2 * SEC);
    const pixelStart = t.clock.now();
    await t.user('oh and check my email');

    // Pixel started the moment Chip delegated: no queue, no waiting for Scout.
    const pixelRun = t.specialists.runs.find((r) => r.agentId === 'workspace')!;
    expect(pixelRun.startedAt).toBe(pixelStart);
    expect(t.jobUpdates('workspace').map((e) => e.state)).toEqual(['running']);
    expect(t.jobUpdates('eagle').map((e) => e.state)).toEqual(['running']);   // Scout was never interrupted
    expect(t.chip.jobs.list().filter((j) => j.state === 'running').map((j) => j.agent).sort()).toEqual(['eagle', 'workspace']);
    expect(t.chipSays('ack').map((e) => e.text)).toEqual(['Scout, fly! We need intel!', "Ooh, mail duty! Pixel, you're up!"]);

    await t.advance(3 * SEC + 1500);                                   // Pixel done + batching window
    expect(t.jobUpdates('workspace').map((e) => e.state)).toEqual(['running', 'done']);
    expect(t.jobUpdates('eagle').map((e) => e.state)).toEqual(['running']);   // Scout still working
    expect(t.chipSays('chip').map((e) => e.text)).toEqual(['Five emails today.']);

    await t.advance(10 * SEC);
    expect(t.jobUpdates('eagle').map((e) => e.state)).toEqual(['running', 'done']);
    expect(t.chipSays('chip').map((e) => e.text)).toEqual(['Five emails today.', "Tony's is closest."]);
  });
});
