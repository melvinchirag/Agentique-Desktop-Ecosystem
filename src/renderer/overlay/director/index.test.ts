import { describe, expect, it } from 'vitest';
import type { AgentId } from '../../../shared/agents';
import type { BiomeEvent } from '../../../shared/events';
import type { Clock } from '../../../main/runtime/types';
import type { EventPlayer } from '../../../main/shell/contracts';
import type { CharacterLayer, DesktopLayout, DirectorDeps, OverlayUi, SfxPlayer, SpeechItem, SpeechOutcome, SpeechQueue } from '../../shell/contracts';
import { createAnimationDirector } from './index';

const ids: AgentId[] = ['chipmunk', 'workspace', 'wolf', 'beaver', 'eagle', 'ants', 'butterfly', 'nightingale'];
const layout: DesktopLayout = {
  width: 1000, height: 600, groundY: 596, centerX: 500, colonyX: 60, hubX: 900,
  dockPoint: { x: 900, y: 28 },
  spots: { ants: 60, beaver: 160, workspace: 260, chipmunk: 380, wolf: 500, eagle: 600, butterfly: 700, nightingale: 780 },
};

class FakeClock implements Clock {
  time = 0;
  next = 0;
  timers = new Map<number, { at: number; fn: () => void }>();
  now() { return this.time; }
  setTimeout(fn: () => void, ms: number) { const id = ++this.next; this.timers.set(id, { at: this.time + ms, fn }); return id; }
  clearTimeout(handle: unknown) { this.timers.delete(handle as number); }
  advance(ms: number) {
    const end = this.time + ms;
    while (true) {
      const next = [...this.timers].sort((a, b) => a[1].at - b[1].at)[0];
      if (!next || next[1].at > end) break;
      this.time = next[1].at;
      this.timers.delete(next[0]);
      next[1].fn();
    }
    this.time = end;
  }
}

type Call = { at: number; name: string; args: unknown[] };

function harness() {
  const clock = new FakeClock();
  const calls: Call[] = [];
  const record = (name: string, ...args: unknown[]) => { calls.push({ at: clock.now(), name, args }); };
  const held = new Set<string>();
  const pending: { name: string; resolve: () => void }[] = [];
  const action = (name: string, ...args: unknown[]): Promise<void> => {
    record(name, ...args);
    return held.has(name) ? new Promise(resolve => pending.push({ name, resolve })) : Promise.resolve();
  };
  const layer: CharacterLayer = {
    spawn: (id, x) => record('spawn', id, x), despawn: id => record('despawn', id), has: () => true,
    play: (id, clip, opts) => action('play', id, clip, opts),
    moveTo: (id, x, opts) => action('moveTo', id, x, opts),
    face: (id, facing) => record('face', id, facing),
    flyOff: id => action('flyOff', id), flyIn: (id, x) => action('flyIn', id, x),
    dockInto: (id, point) => action('dockInto', id, point), undock: (id, x) => action('undock', id, x),
    setMood: (id, mood, intensity) => record('setMood', id, mood, intensity),
    setMouth: (id, open) => record('setMouth', id, open), setProp: (id, prop) => record('setProp', id, prop),
    antCarrier: (from, to) => action('antCarrier', from, to),
    screenRect: () => null,
    position: id => ({ x: layout.spots[id], y: layout.groundY }),
    setVisible: visible => record('setVisible', visible), setLayout: next => record('setLayout', next),
  };
  let start: (item: SpeechItem) => void = () => {};
  let end: (item: SpeechItem, outcome: SpeechOutcome) => void = () => {};
  const items: SpeechItem[] = [];
  const speech: SpeechQueue = {
    enqueue: item => { items.push(item); record('enqueue', item); }, clear: () => {}, get current() { return null; },
    setVoiceEnabled: () => {}, setVolume: () => {},
    onStart: cb => { start = cb; return () => { start = () => {}; }; },
    onEnd: cb => { end = cb; return () => { end = () => {}; }; }, dispose: () => {},
  };
  const fireStart = (item = items.at(-1)!) => start(item);
  const fireEnd = (item = items.at(-1)!) => end(item, 'played');
  const ui: OverlayUi = {
    showBubble: (id, text, kind) => record('showBubble', id, text, kind),
    clearBubble: id => record('clearBubble', id), sparkle: id => record('sparkle', id),
    puff: (id, ok) => record('puff', id, ok), showApproval: approval => record('showApproval', approval),
    closeApproval: callId => record('closeApproval', callId), openInspect: id => record('openInspect', id),
    closeInspect: () => {}, flyToHub: (id, title) => record('flyToHub', id, title),
    setReplayBanner: on => record('setReplayBanner', on),
  };
  const sfx: SfxPlayer = { play: name => record('sfx', name), setVolume: () => {}, setEnabled: () => {} };
  let player: EventPlayer<BiomeEvent> | null = null;
  const deps: DirectorDeps = {
    layer, speech, ui, sfx, getLayout: () => layout, clock,
    getTaskEvents: async () => [],
    createPlayer: () => {
      let done: () => void = () => {};
      let onEvent: (e: BiomeEvent) => void = () => {};
      let entries: { atMs: number; event: BiomeEvent }[] = [];
      let state: EventPlayer<BiomeEvent>['state'] = 'idle';
      player = {
        get state() { return state; },
        load: items => { entries = [...items]; state = 'idle'; record('load', entries); },
        setSpeed: speed => record('setSpeed', speed),
        play: cb => { onEvent = cb; state = 'playing'; record('playerPlay'); },
        pause: () => {}, resume: () => {},
        stop: () => { state = 'idle'; record('playerStop'); },
        onDone: cb => { done = cb; return () => { done = () => {}; }; },
      };
      emit = (index: number) => onEvent(entries[index].event);
      complete = () => { state = 'done'; done(); };
      return player;
    },
  };
  let emit: (index: number) => void = () => {};
  let complete: () => void = () => {};
  const director = createAnimationDirector(deps);
  const events = (name: string) => calls.filter(call => call.name === name);
  const clips = (id: AgentId) => events('play').filter(call => call.args[0] === id).map(call => call.args[1]);
  const release = (name: string) => { const index = pending.findIndex(p => p.name === name); expect(index).toBeGreaterThanOrEqual(0); pending.splice(index, 1)[0].resolve(); };
  return { clock, calls, events, clips, held, pending, release, director, deps, items, fireStart, fireEnd,
    emit: (index: number) => emit(index), complete: () => complete(), get player() { return player; } };
}

function event(type: BiomeEvent['type'], fields: Record<string, unknown> = {}, agentId: AgentId = 'chipmunk'): BiomeEvent {
  return { id: `${type}-${Math.random()}`, ts: 0, sessionId: 'test', agentId, type, ...fields } as BiomeEvent;
}

async function settle() { for (let i = 0; i < 120; i++) await Promise.resolve(); }

describe('AnimationDirector event choreography', () => {
  it('user.message listens once, then thinks', async () => {
    const h = harness(); h.director.handle(event('user.message', { text: 'hello', source: 'text' })); await settle();
    expect(h.clips('chipmunk')).toEqual(['Listen', 'Think']);
    expect(h.events('play')[0].args[2]).toEqual({ once: true });
  });

  it('agent.status maps all states, bubbles, and away return', async () => {
    const h = harness();
    for (const status of ['thinking', 'working', 'speaking', 'waiting_approval', 'error', 'idle', 'listening', 'done'] as const) {
      h.director.handle(event('agent.status', { status, detail: status === 'working' ? 'Writing' : undefined }));
    }
    h.director.handle(event('agent.status', { status: 'waiting_approval' }, 'wolf'));
    h.director.handle(event('agent.status', { status: 'error' }, 'beaver'));
    h.director.handle(event('agent.status', { status: 'away' }, 'eagle'));
    h.director.handle(event('agent.status', { status: 'done' }, 'eagle'));
    await settle();
    expect(h.clips('chipmunk')).toEqual(['Think', 'Work', 'Talk', 'Idle', 'Dizzy', 'Sad', 'Idle', 'Listen', 'Idle']);
    expect(h.clips('wolf')).toContain('Sit');
    expect(h.clips('beaver')).toContain('Sad');
    expect(h.events('showBubble').map(x => x.args)).toContainEqual(['chipmunk', 'Writing', 'status']);
    expect(h.events('showBubble').map(x => x.args)).toContainEqual(['chipmunk', '…', 'waiting']);
    expect(h.events('clearBubble')[0].args).toEqual(['chipmunk']);
    expect(h.events('flyOff')[0].args).toEqual(['eagle']);
    expect(h.events('flyIn')[0].args).toEqual(['eagle', 600]);
  });

  it('agent.mood tints, loops, and plays happy and relief once', async () => {
    const h = harness();
    for (const mood of ['scared', 'nervous', 'sad', 'excited', 'happy', 'relieved', 'neutral'] as const) {
      h.director.handle(event('agent.mood', { mood, intensity: mood === 'happy' ? 0.9 : 0.5, cause: 'user' }));
    }
    h.director.handle(event('agent.mood', { mood: 'happy', intensity: 0.9, cause: 'user' }, 'beaver'));
    await settle();
    expect(h.clips('chipmunk')).toEqual(['Scared', 'Nervous', 'Sad', 'Excited', 'Celebrate', 'Idle', 'Relief', 'Idle', 'Idle']);
    expect(h.clips('beaver')).toContain('Happy');
    expect(h.events('setMood')).toHaveLength(8);
  });

  it('Chip uses TalkScared while its status is speaking and its mood is scared', async () => {
    const h = harness();
    h.director.handle(event('agent.status', { status: 'speaking' }));
    h.director.handle(event('agent.mood', { mood: 'scared', intensity: 1, cause: 'user' }));
    await settle();
    expect(h.clips('chipmunk').at(-1)).toBe('TalkScared');
  });

  it('agent.handoff passes the scroll, returns home, and holds both queues', async () => {
    const h = harness(); h.held.add('moveTo');
    h.director.handle(event('agent.handoff', { to: 'workspace', task: 'email' }));
    h.director.handle(event('agent.status', { status: 'working' }, 'workspace'));
    await settle();
    expect(h.events('moveTo')[0].args).toEqual(['chipmunk', 320, { gait: 'run' }]);
    expect(h.clips('workspace')).toEqual([]);
    h.release('moveTo'); await settle();
    expect(h.clips('chipmunk')).toContain('Handoff');
    h.clock.advance(300); await settle();
    expect(h.events('setProp').map(x => x.args)).toContainEqual(['workspace', 'scroll']);
    h.release('moveTo'); await settle();
    expect(h.events('moveTo')[1].args).toEqual(['chipmunk', 380, { gait: 'run' }]);
    expect(h.clips('workspace')).toContain('Work');
  });

  it('agent.handoff via ants sends a carrier and wakes a docked target first', async () => {
    const h = harness();
    h.director.handle(event('agent.presence', { presence: 'docked', reason: 'dock_timeout' }, 'beaver'));
    await settle();
    h.director.handle(event('agent.handoff', { to: 'beaver', task: 'files', via: 'ants' }));
    await settle();
    expect(h.events('undock')[0].args).toEqual(['beaver', 160]);
    expect(h.events('antCarrier')[0].args).toEqual([60, 160]);
    expect(h.events('undock')[0].at).toBeLessThanOrEqual(h.events('antCarrier')[0].at);
  });

  it('agent.handoff leaves an away target off screen', async () => {
    const h = harness();
    h.director.handle(event('agent.status', { status: 'away' }, 'eagle'));
    await settle();
    h.director.handle(event('agent.handoff', { to: 'eagle', task: 'search' }));
    await settle(); h.clock.advance(300); await settle();
    expect(h.events('flyOff')).toHaveLength(1);
    expect(h.events('flyIn')).toHaveLength(0);
    expect(h.events('undock')).toHaveLength(0);
    expect(h.events('setProp').filter(x => x.args[0] === 'eagle')).toHaveLength(0);
  });

  it('help job walks the asker to the helper and back after one second', async () => {
    const h = harness();
    h.director.handle(event('job.update', { jobId: 'j', to: 'eagle', state: 'running', title: 'Research', requestedBy: 'beaver' }, 'eagle'));
    await settle();
    expect(h.events('moveTo')[0].args).toEqual(['beaver', 540, { gait: 'walk' }]);
    h.clock.advance(999); await settle(); expect(h.events('moveTo')).toHaveLength(1);
    h.clock.advance(1); await settle(); expect(h.events('moveTo')[1].args).toEqual(['beaver', 160, { gait: 'walk' }]);
  });

  it('agent.return turns toward Chip and makes Chip happy', async () => {
    const h = harness(); h.director.handle(event('agent.return', { to: 'chipmunk', ok: true, summary: 'done' }, 'eagle')); await settle();
    expect(h.events('face')[0].args).toEqual(['eagle', 'left']);
    expect(h.clips('chipmunk')).toContain('Happy');
  });

  it('agent.say uses the current mood and talks only during speech', async () => {
    const h = harness();
    h.director.handle(event('agent.mood', { mood: 'scared', intensity: 1, cause: 'user' })); await settle();
    h.director.handle(event('agent.say', { text: 'Full text', bubble: 'Oh!', priority: 'chip' })); await settle();
    expect(h.items[0]).toEqual({ agentId: 'chipmunk', text: 'Full text', mood: 'scared', priority: 'chip' });
    expect(h.events('showBubble').at(-1)?.args).toEqual(['chipmunk', 'Oh!', 'say']);
    h.fireStart(); await settle(); expect(h.clips('chipmunk').at(-1)).toBe('TalkScared');
    h.fireEnd(); await settle(); expect(h.clips('chipmunk').at(-1)).toBe('Scared');
  });

  it('agent.recall sparkles', async () => {
    const h = harness(); h.director.handle(event('agent.recall', { memories: ['one'] }, 'workspace')); await settle();
    expect(h.events('sparkle')[0].args).toEqual(['workspace']);
  });

  it('agent.presence greets, sleeps, docks, wakes, and despawns; Chip never docks', async () => {
    const h = harness();
    h.director.handle(event('agent.presence', { presence: 'active', reason: 'startup' }, 'beaver'));
    h.director.handle(event('agent.presence', { presence: 'sleeping', reason: 'idle_timeout' }, 'beaver'));
    h.director.handle(event('agent.presence', { presence: 'docked', reason: 'dock_timeout' }, 'beaver'));
    h.director.handle(event('agent.presence', { presence: 'active', reason: 'user' }, 'beaver'));
    h.director.handle(event('agent.presence', { presence: 'not_installed', reason: 'user' }, 'beaver'));
    h.director.handle(event('agent.presence', { presence: 'docked', reason: 'dock_timeout' }));
    await settle();
    expect(h.clips('beaver')).toEqual(['Greet', 'Idle', 'Yawn', 'Sleep', 'Idle']);
    expect(h.events('moveTo')[0].args).toEqual(['beaver', 900, { gait: 'sleepwalk' }]);
    expect(h.events('dockInto')[0].args).toEqual(['beaver', { x: 900, y: 28 }]);
    expect(h.events('undock')[0].args).toEqual(['beaver', 160]);
    expect(h.events('despawn')[0].args).toEqual(['beaver']);
    expect(h.events('dockInto')).toHaveLength(1);
  });

  it('sleeping to active plays WakeUp; Scout wakes from a dock by flying in', async () => {
    const h = harness();
    h.director.handle(event('agent.presence', { presence: 'sleeping', reason: 'idle_timeout' }));
    h.director.handle(event('agent.presence', { presence: 'active', reason: 'user' }));
    h.director.handle(event('agent.presence', { presence: 'docked', reason: 'dock_timeout' }, 'eagle'));
    h.director.handle(event('agent.presence', { presence: 'active', reason: 'user' }, 'eagle'));
    await settle();
    expect(h.clips('chipmunk')).toContain('WakeUp');
    expect(h.events('flyIn')[0].args).toEqual(['eagle', 600]);
  });

  it('nudge wakes Chip, knocks at center, then walks home after three seconds', async () => {
    const h = harness(); h.director.handle(event('agent.presence', { presence: 'sleeping', reason: 'idle_timeout' })); await settle();
    h.director.handle(event('nudge.fire', { nudgeId: 'n', kind: 'daily', about: 'exam' })); await settle();
    expect(h.clips('chipmunk')).toContain('WakeUp');
    expect(h.events('moveTo')[0].args).toEqual(['chipmunk', 500, { gait: 'walk' }]);
    expect(h.events('sfx')[0].args).toEqual(['knock']);
    h.clock.advance(3000); await settle();
    expect(h.events('moveTo')[1].args).toEqual(['chipmunk', 380, { gait: 'walk' }]);
  });

  it('tool.request guards on elevated risk only', async () => {
    const h = harness();
    for (const risk of ['read', 'write', 'destructive', 'external']) h.director.handle(event('tool.request', { callId: risk, tool: 'tool', args: {}, risk }, 'beaver'));
    await settle();
    expect(h.clips('wolf').filter(x => x === 'Guard')).toHaveLength(3);
    expect(h.events('face').filter(x => x.args[0] === 'wolf')).toHaveLength(3);
  });

  it('wolf.verdict asks beside the caller, denies with block and growl, and ignores allow', async () => {
    const h = harness();
    h.director.handle(event('tool.request', { callId: 'c', tool: 'delete', args: {}, risk: 'read' }, 'beaver'));
    h.director.handle(event('wolf.verdict', { callId: 'c', verdict: 'ask', rule: '', reason: '' }, 'wolf'));
    h.director.handle(event('wolf.verdict', { callId: 'c', verdict: 'deny', rule: '', reason: '' }, 'wolf'));
    h.director.handle(event('wolf.verdict', { callId: 'c', verdict: 'allow', rule: '', reason: '' }, 'wolf'));
    await settle();
    expect(h.events('moveTo')[0].args).toEqual(['wolf', 220, { gait: 'walk' }]);
    expect(h.clips('wolf')).toContain('Sit');
    expect(h.events('moveTo')[1].args).toEqual(['wolf', 160, { gait: 'run' }]);
    expect(h.clips('wolf')).toContain('Block');
    expect(h.events('sfx')[0].args).toEqual(['growl']);
    expect(h.events('setMood')[0].args.slice(0, 2)).toEqual(['wolf', 'protective']);
    h.clock.advance(2000); await settle();
    expect(h.events('moveTo')[2].args).toEqual(['wolf', 500, { gait: 'walk' }]);
  });

  it('wolf.alert howls with a short warning', async () => {
    const h = harness(); h.director.handle(event('wolf.alert', { source: 'scan', reason: 'x'.repeat(100) }, 'wolf')); await settle();
    expect(h.clips('wolf')).toContain('Howl');
    const bubble = h.events('showBubble')[0].args;
    expect(bubble[0]).toBe('wolf'); expect((bubble[1] as string).length).toBeLessThanOrEqual(64); expect(bubble[2]).toBe('warning');
  });

  it('approval.request and resolve show and close the card, then return Warden home', async () => {
    const h = harness();
    h.director.handle(event('approval.request', { callId: 'c', title: 'Send?', preview: 'message' }, 'wolf'));
    h.director.handle(event('approval.resolve', { callId: 'c', approved: true }, 'wolf'));
    await settle();
    expect(h.events('showApproval')[0].args[0]).toEqual({ callId: 'c', title: 'Send?', preview: 'message', nearAgent: 'wolf' });
    expect(h.events('closeApproval')[0].args).toEqual(['c']);
    expect(h.events('moveTo')[0].args).toEqual(['wolf', 500, { gait: 'walk' }]);
  });

  it('tool.result puffs and artifact flies to the Hub', async () => {
    const h = harness();
    h.director.handle(event('tool.result', { callId: 'c', ok: false, summary: 'failed' }, 'workspace'));
    h.director.handle(event('artifact', { kind: 'email_draft', title: 'Draft', data: {} }, 'workspace'));
    await settle();
    expect(h.events('puff')[0].args).toEqual(['workspace', false]);
    expect(h.events('flyToHub')[0].args).toEqual(['workspace', 'Draft']);
  });

  it('ordinary job.update has no overlay action', async () => {
    const h = harness(); h.director.handle(event('job.update', { jobId: 'j', to: 'beaver', state: 'done', title: 'Files', requestedBy: 'chipmunk' })); await settle();
    expect(h.calls).toEqual([]);
  });

  it('serializes a second move behind the first', async () => {
    const h = harness(); h.held.add('moveTo');
    h.director.handle(event('nudge.fire', { nudgeId: 'one', kind: 'daily', about: 'one' }));
    h.director.handle(event('nudge.fire', { nudgeId: 'two', kind: 'daily', about: 'two' }));
    await settle(); expect(h.events('moveTo')).toHaveLength(1);
    h.release('moveTo'); await settle(); h.clock.advance(3000); await settle(); h.release('moveTo'); await settle();
    expect(h.events('moveTo')).toHaveLength(3);
  });

  it('setLayout walks idle grounded animals to new homes and updates the dock target', async () => {
    const h = harness(); h.director.handle(event('agent.presence', { presence: 'active', reason: 'startup' }, 'beaver')); await settle();
    const changed = { ...layout, hubX: 400, dockPoint: { x: 400, y: 50 }, spots: { ...layout.spots, beaver: 180 } };
    h.director.setLayout(changed); await settle();
    expect(h.events('setLayout')[0].args[0]).toBe(changed);
    expect(h.events('moveTo')[0].args).toEqual(['beaver', 180, { gait: 'walk' }]);
    h.director.handle(event('agent.presence', { presence: 'docked', reason: 'dock_timeout' }, 'beaver')); await settle();
    expect(h.events('dockInto')[0].args).toEqual(['beaver', { x: 400, y: 50 }]);
  });

  it('replay runs events at 2x, queues live events, and flushes them in order', async () => {
    const h = harness();
    const first = event('agent.recall', { memories: [] }, 'beaver'); first.ts = 100;
    const second = event('agent.recall', { memories: [] }, 'eagle'); second.ts = 300;
    h.deps.getTaskEvents = async () => [first, second];
    const running = h.director.replay('task'); await settle();
    expect(h.director.replaying).toBe(true);
    expect(h.events('setReplayBanner')[0].args).toEqual([true]);
    expect(h.events('load')[0].args[0]).toEqual([{ atMs: 0, event: first }, { atMs: 200, event: second }]);
    expect(h.events('setSpeed')[0].args).toEqual([2]);
    h.director.handle(event('agent.recall', { memories: [] }, 'chipmunk'));
    h.director.handle(event('agent.recall', { memories: [] }, 'wolf'));
    h.emit(0); h.emit(1); await settle();
    expect(h.events('sparkle').map(x => x.args[0])).toEqual(['beaver', 'eagle']);
    h.complete(); await running; await settle();
    expect(h.events('sparkle').map(x => x.args[0])).toEqual(['beaver', 'eagle', 'chipmunk', 'wolf']);
    expect(h.events('setReplayBanner').at(-1)?.args).toEqual([false]);
  });

  it('stopReplay flushes live events, and dispose clears timed work and listeners', async () => {
    const h = harness(); h.deps.getTaskEvents = async () => [event('agent.recall', { memories: [] })];
    const running = h.director.replay('task'); await settle();
    h.director.handle(event('agent.recall', { memories: [] }, 'beaver'));
    h.director.stopReplay(); await running; await settle();
    expect(h.events('sparkle').map(x => x.args[0])).toEqual(['beaver']);
    h.director.handle(event('nudge.fire', { nudgeId: 'n', kind: 'daily', about: 'test' })); await settle();
    expect(h.clock.timers.size).toBe(1);
    h.director.dispose(); expect(h.clock.timers.size).toBe(0);
    h.fireStart({ agentId: 'chipmunk', text: '', mood: 'neutral', priority: 'chip' }); await settle();
    expect(h.clips('chipmunk')).not.toContain('Talk');
  });

  it('stopReplay resolves while event retrieval is still pending', async () => {
    const h = harness();
    let provide: (events: BiomeEvent[]) => void = () => {};
    h.deps.getTaskEvents = () => new Promise(resolve => { provide = resolve; });
    const running = h.director.replay('task');
    h.director.handle(event('agent.recall', { memories: [] }, 'beaver'));
    h.director.stopReplay();
    await running; await settle();
    expect(h.events('sparkle')[0].args).toEqual(['beaver']);
    provide([event('agent.recall', { memories: [] }, 'wolf')]);
    await settle();
    expect(h.events('sparkle')).toHaveLength(1);
  });
});
