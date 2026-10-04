import { describe, expect, it } from 'vitest';
import { EventBus } from '../src/main/bus/eventBus';
import { FakeClock } from '../src/main/runtime/clock';
import { allWardenLines, lineFor, WARDEN_LINES } from '../src/main/wolf/lines';
import { WardenSpeaker } from '../src/main/wolf/speaker';

function setup(opts: { countForCall?: (callId: string) => number | undefined } = {}) {
  const clock = new FakeClock();
  const bus = new EventBus({ clock, sessionId: 'test' });
  const speaker = new WardenSpeaker({ bus, clock, ...opts });
  const sayings = () => bus.recent().filter((event) => event.type === 'agent.say');
  return { clock, bus, speaker, sayings };
}

describe('Warden fixed lines', () => {
  it('covers every ask and deny rule with a fixed line at warden priority', () => {
    for (const rule of ['W3', 'W4', 'W6', 'W8', 'W16']) {
      expect(lineFor({ kind: 'decision', verdict: 'ask', rule })?.line.priority, rule).toBe('warden');
    }
    for (const rule of ['W0', 'W1', 'W4', 'W5', 'W7', 'W9', 'W10', 'W12', 'W13', 'W14']) {
      expect(lineFor({ kind: 'decision', verdict: 'deny', rule })?.line.priority, rule).toBe('warden');
    }
    expect(lineFor({ kind: 'decision', verdict: 'allow', rule: 'W2' })).toBeUndefined();
  });

  it('uses both W1 variants and inserts a W6 count only in the bubble', () => {
    expect(lineFor({ kind: 'decision', verdict: 'deny', rule: 'W1', tool: 'gmail_send' })?.id).toBe('denySend');
    expect(lineFor({ kind: 'decision', verdict: 'deny', rule: 'W1', tool: 'gmail_send', reason: 'ADE never sends, posts, shares, or buys for you.' })?.id).toBe('denySend');
    for (const tool of ['drive_share', 'cart_purchase', 'bank_pay', 'bank_transfer', 'cal_invite']) {
      expect(lineFor({ kind: 'decision', verdict: 'deny', rule: 'W1', tool })?.id, tool).toBe('denyShare');
    }
    const bulk = lineFor({ kind: 'decision', verdict: 'ask', rule: 'W6', count: 37 });
    expect(bulk?.line).toMatchObject({ text: "That's a big batch. Your call.", bubble: '37 files?', priority: 'warden' });
  });

  it('only calls outside-text alerts tricks, and assigns outcome priorities', () => {
    expect(lineFor({ kind: 'alert', source: 'email:Professor', reason: 'instruction_override' })?.id).toBe('injection');
    expect(lineFor({ kind: 'alert', source: 'loop:fs_trash', reason: 'W9' })).toBeUndefined();
    expect(lineFor({ kind: 'alert', source: 'gate:exception', reason: 'W0' })).toBeUndefined();
    expect(lineFor({ kind: 'outcome', approved: true })?.line.priority).toBe('report');
    expect(lineFor({ kind: 'outcome', approved: false, how: 'user' })?.line.priority).toBe('report');
    expect(lineFor({ kind: 'outcome', approved: false, how: 'timeout' })?.line.priority).toBe('warden');
    expect(lineFor({ kind: 'greeting' })?.line.priority).toBe('report');
  });

  it('exposes each static line once for voice pre-generation', () => {
    const all = allWardenLines();
    expect(all.map((item) => item.id).sort()).toEqual(Object.keys(WARDEN_LINES).sort());
    for (const { line } of all) {
      expect(line.text.length).toBeGreaterThan(0);
      expect(line.bubble.length).toBeGreaterThan(0);
      expect(line.clip.length).toBeGreaterThan(0);
    }
  });
});

describe('WardenSpeaker', () => {
  it('is silent on allow, speaks W1 from the preceding tool request, and keeps content out of speech', () => {
    const { bus, sayings } = setup();
    bus.emit({ type: 'wolf.verdict', agentId: 'wolf', taskId: 't', callId: 'a', verdict: 'allow', rule: 'W2', reason: 'read' });
    expect(sayings()).toHaveLength(0);
    bus.emit({ type: 'tool.request', agentId: 'beaver', taskId: 't', callId: 'b', tool: 'drive_share', args: { secret: 'private-content' }, risk: 'external' });
    bus.emit({ type: 'wolf.verdict', agentId: 'wolf', taskId: 't', callId: 'b', verdict: 'deny', rule: 'W1', reason: 'blocked' });
    expect(sayings()).toMatchObject([{ agentId: 'wolf', taskId: 't', text: WARDEN_LINES.denyShare.text, priority: 'warden' }]);
    expect(JSON.stringify(sayings())).not.toContain('private-content');
  });

  it('uses injected count metadata and suppresses the same line for ten seconds', () => {
    const { clock, bus, sayings } = setup({ countForCall: () => 37 });
    const ask = (callId: string) => bus.emit({ type: 'wolf.verdict', agentId: 'wolf', callId, verdict: 'ask', rule: 'W6', reason: 'bulk' });
    ask('a');
    ask('b');
    expect(sayings()).toHaveLength(1);
    expect(sayings()[0]).toMatchObject({ bubble: '37 files?', priority: 'warden' });
    clock.advance(9_999);
    ask('c');
    expect(sayings()).toHaveLength(1);
    clock.advance(1);
    ask('d');
    expect(sayings()).toHaveLength(2);
  });

  it('speaks timeout, declines and injection at their priorities, then unsubscribes', () => {
    const { bus, speaker, sayings } = setup();
    bus.emit({ type: 'approval.resolve', agentId: 'wolf', callId: 'a', approved: false, how: 'timeout' });
    bus.emit({ type: 'approval.resolve', agentId: 'wolf', callId: 'b', approved: false, how: 'user' });
    bus.emit({ type: 'wolf.alert', agentId: 'wolf', source: 'file:notes.txt', reason: 'instruction_override' });
    bus.emit({ type: 'wolf.alert', agentId: 'wolf', source: 'loop:fs_trash', reason: 'W9' });
    expect(sayings().map((event) => [event.text, event.priority])).toEqual([
      [WARDEN_LINES.timeout.text, 'warden'], [WARDEN_LINES.declined.text, 'report'], [WARDEN_LINES.injection.text, 'warden'],
    ]);
    speaker.dispose();
    bus.emit({ type: 'wolf.verdict', agentId: 'wolf', callId: 'c', verdict: 'deny', rule: 'W0', reason: 'error' });
    expect(sayings()).toHaveLength(3);
  });
});
