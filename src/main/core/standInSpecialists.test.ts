import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventBus } from '../bus/eventBus';
import { RealClock } from '../runtime/clock';
import { soundsForEvent } from '../../renderer/overlay/director/sounds';
import { handleStandInSendPost, StandInSpecialists } from './standInSpecialists';

afterEach(() => vi.useRealTimers());

describe('real-mode stand-in events', () => {
  it('makes Pixel and Archie visibly work, report, and sound', async () => {
    vi.useFakeTimers();
    const clock = new RealClock();
    const bus = new EventBus({ clock });
    const events: ReturnType<typeof bus.recent> = [];
    bus.subscribe(event => events.push(event));
    const runner = new StandInSpecialists(clock);
    runner.connect(bus);
    for (const [id, sound] of [['workspace', 'workspace.blip'], ['beaver', 'beaver.wood-gnaw']] as const) {
      const result = runner.run(id, 'Review the latest notes', { jobId: id, taskId: id, kind: 'normal', signal: new AbortController().signal });
      expect(events.some(e => e.type === 'agent.status' && e.agentId === id && e.status === 'working' && !!e.detail)).toBe(true);
      await vi.advanceTimersByTimeAsync(4200);
      expect((await result).artifacts).toHaveLength(1);
      expect(events.some(e => e.type === 'artifact' && e.agentId === id)).toBe(true);
      expect(events.flatMap(soundsForEvent)).toContain(sound);
    }
    expect(events.flatMap(soundsForEvent)).toContain('workspace.stamp');
    expect(events.flatMap(soundsForEvent)).toContain('beaver.tail-slap');
  });

  it('emits Warden request, denial, speech, and both wolf sounds for send/post attempts', async () => {
    const clock = new RealClock();
    const bus = new EventBus({ clock });
    const events: ReturnType<typeof bus.recent> = [];
    bus.subscribe(event => events.push(event));
    expect(handleStandInSendPost(bus, 'send it')).toBe(true);
    expect(events.some(e => e.type === 'agent.status' && e.agentId === 'chipmunk' && e.status === 'idle')).toBe(true);
    const runner = new StandInSpecialists(clock);
    runner.connect(bus);
    expect((await runner.run('workspace', 'Post this draft', { jobId: 'j', taskId: 't', kind: 'normal', signal: new AbortController().signal })).ok).toBe(false);
    expect(events.filter(e => e.type === 'wolf.verdict' && e.verdict === 'deny')).toHaveLength(2);
    expect(events.filter(e => e.type === 'agent.say' && e.agentId === 'wolf')).toHaveLength(2);
    expect(events.flatMap(soundsForEvent)).toContain('wolf.sniff');
    expect(events.flatMap(soundsForEvent)).toContain('wolf.growl');
  });
});
