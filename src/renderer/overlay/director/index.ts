import type { AgentId, AgentMood, AgentStatus, Presence } from '../../../shared/agents';
import type { BiomeEvent } from '../../../shared/events';
import type { Clock } from '../../../main/runtime/types';
import type { EventPlayer } from '../../../main/shell/contracts';
import type { AnimationDirector, CreateAnimationDirector, DesktopLayout, DirectorDeps, SpeechItem } from '../../shell/contracts';
import { soundsForEvent } from './sounds';

const IDS: AgentId[] = ['chipmunk', 'workspace', 'wolf', 'beaver', 'eagle', 'ants', 'butterfly', 'nightingale'];
const systemClock: Clock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: handle => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

interface AgentState {
  presence: Presence;
  status: AgentStatus;
  mood: AgentMood;
  docked: boolean;
  away: boolean;
  home: number;
  bubble: 'status' | 'waiting' | null;
}

export const createAnimationDirector: CreateAnimationDirector = (deps: DirectorDeps): AnimationDirector => {
  const { layer, speech, sfx, ui } = deps;
  const clock = deps.clock ?? systemClock;
  let layout = deps.getLayout();
  const agents = Object.fromEntries(IDS.map(id => [id, {
    presence: 'not_installed', status: 'idle', mood: 'neutral', docked: false, away: false,
    home: layout.spots[id], bubble: null,
  }])) as Record<AgentId, AgentState>;
  const tails = Object.fromEntries(IDS.map(id => [id, Promise.resolve()])) as Record<AgentId, Promise<void>>;
  const calls = new Map<string, AgentId>();
  const speechOwners = new WeakMap<SpeechItem, AgentId>();
  const speaking = new WeakSet<SpeechItem>();
  const timers = new Map<unknown, () => void>();
  let disposed = false;
  let replaying = false;
  let player: EventPlayer<BiomeEvent> | null = null;
  let offDone: (() => void) | null = null;
  let finishReplay: (() => void) | null = null;
  let replayToken = 0;
  const liveQueue: BiomeEvent[] = [];

  function queue(ids: AgentId[], action: () => Promise<void> | void): void {
    if (disposed) return;
    const unique = [...new Set(ids)];
    const run = Promise.all(unique.map(id => tails[id])).then(() => {
      if (!disposed) return action();
    });
    const settled = run.then(() => {}, () => {});
    for (const id of unique) tails[id] = settled;
  }

  function wait(ms: number): Promise<void> {
    if (disposed) return Promise.resolve();
    return new Promise(resolve => {
      const handle = clock.setTimeout(() => {
        timers.delete(handle);
        resolve();
      }, ms);
      timers.set(handle, resolve);
    });
  }

  function clipFor(id: AgentId): string {
    const a = agents[id];
    if (a.presence === 'sleeping') return 'Sleep';
    if (a.status === 'speaking' && id === 'chipmunk' && a.mood === 'scared') return 'TalkScared';
    if (a.status === 'speaking' && id === 'chipmunk' && a.mood === 'happy') return 'TalkHappy';
    if (a.mood === 'scared') return 'Scared';
    if (a.mood === 'nervous') return 'Nervous';
    if (a.mood === 'sad') return 'Sad';
    if (a.mood === 'excited') return 'Excited';
    switch (a.status) {
      case 'thinking': return 'Think';
      case 'working': return 'Work';
      case 'speaking': return 'Talk';
      case 'listening': return id === 'chipmunk' ? 'Listen' : 'Idle';
      case 'waiting_approval': return id === 'wolf' ? 'Sit' : 'Idle';
      case 'error': return 'Sad';
      default: return 'Idle';
    }
  }

  async function loop(id: AgentId): Promise<void> {
    if (!agents[id].docked && !agents[id].away && layer.has(id)) {
      await layer.play(id, clipFor(id));
    }
  }

  function xOf(id: AgentId): number {
    return layer.position(id)?.x ?? agents[id].home;
  }

  function faceToward(id: AgentId, x: number): void {
    layer.face(id, x < xOf(id) ? 'left' : 'right');
  }

  async function wakeTarget(id: AgentId): Promise<void> {
    const a = agents[id];
    if (a.away) return;
    if (a.docked) {
      if (id === 'eagle') await layer.flyIn(id, a.home);
      else await layer.undock(id, a.home);
      a.docked = false;
      a.presence = 'active';
    } else if (a.presence === 'sleeping') {
      a.presence = 'active';
      a.mood = 'neutral';
      layer.setMood(id, 'neutral');
      await layer.play(id, 'WakeUp', { once: true });
      await loop(id);
    }
  }

  function handleEvent(e: BiomeEvent): void {
    const id = e.agentId;
    const a = agents[id];
    if (!(e.type === 'agent.presence' && e.presence === a.presence && (e.presence === 'sleeping' || e.presence === 'active'))) {
      for (const sound of soundsForEvent(e)) sfx.play(sound);
    }
    switch (e.type) {
      case 'user.message':
        queue(['chipmunk'], async () => {
          await wakeTarget('chipmunk');
          await layer.play('chipmunk', 'Listen', { once: true });
          agents.chipmunk.status = 'thinking';
          await layer.play('chipmunk', 'Think');
        });
        break;
      case 'user.mood':
        break;
      case 'agent.status':
        queue([id], async () => {
          a.status = e.status;
          if (e.status === 'away' && id === 'eagle') {
            if (!a.away) { await layer.flyOff(id); a.away = true; }
            return;
          }
          if ((e.status === 'idle' || e.status === 'done') && a.away) {
            await layer.flyIn(id, a.home);
            a.away = false;
          }
          if (e.status === 'idle' || e.status === 'done') {
            if (a.bubble) { ui.clearBubble(id); a.bubble = null; }
          } else if (e.status === 'working' && e.detail) {
            ui.showBubble(id, e.detail, 'status');
            a.bubble = 'status';
          } else if (e.status === 'waiting_approval') {
            ui.showBubble(id, '…', 'waiting');
            a.bubble = 'waiting';
          }
          if (e.status === 'error' && id === 'chipmunk') await layer.play(id, 'Dizzy', { once: true });
          await loop(id);
        });
        break;
      case 'agent.mood':
        queue([id], async () => {
          a.mood = e.mood;
          layer.setMood(id, e.mood, e.intensity);
          if (e.mood === 'happy') await layer.play(id, id === 'chipmunk' && e.intensity >= 0.8 ? 'Celebrate' : 'Happy', { once: true });
          else if (e.mood === 'relieved') await layer.play(id, id === 'chipmunk' ? 'Relief' : 'Happy', { once: true });
          await loop(id);
        });
        break;
      case 'agent.handoff':
        if (e.via === 'ants') {
          queue(['ants', e.to], async () => {
            if (!agents[e.to].away) await wakeTarget(e.to);
            await layer.antCarrier(layout.colonyX, agents[e.to].home);
          });
        } else {
          queue(['chipmunk', e.to], async () => {
            if (!agents[e.to].away) await wakeTarget(e.to);
            layer.setProp('chipmunk', 'scroll');
            try {
              const targetX = agents[e.to].home;
              const approach = targetX + (agents.chipmunk.home < targetX ? -60 : 60);
              await layer.moveTo('chipmunk', approach, { gait: 'run' });
              if (disposed) return;
              faceToward('chipmunk', targetX);
              await layer.play('chipmunk', 'Handoff', { once: true });
              if (disposed) return;
              layer.setProp('chipmunk', null);
              if (!agents[e.to].away) {
                layer.setProp(e.to, 'scroll');
                await wait(300);
                if (disposed) return;
                layer.setProp(e.to, null);
              }
              await layer.moveTo('chipmunk', agents.chipmunk.home, { gait: 'run' });
              if (disposed) return;
              await loop('chipmunk');
            } finally {
              layer.setProp('chipmunk', null);
              if (!agents[e.to].away) layer.setProp(e.to, null);
            }
          });
        }
        break;
      case 'agent.return':
        queue([id, 'chipmunk'], async () => {
          faceToward(id, agents.chipmunk.home);
          await layer.play('chipmunk', 'Happy', { once: true });
          await loop('chipmunk');
        });
        break;
      case 'agent.say':
        ui.showBubble(id, e.bubble, 'say');
        a.bubble = null;
        queue([id], () => {
          const item: SpeechItem = { agentId: id, text: e.text, mood: a.mood, priority: e.priority };
          speechOwners.set(item, id);
          speech.enqueue(item);
        });
        break;
      case 'agent.recall':
        ui.sparkle(id);
        break;
      case 'agent.presence':
        if (id === 'chipmunk' && e.presence === 'docked') break;
        queue([id], async () => {
          const previous = a.presence;
          if (e.presence === 'not_installed') {
            layer.despawn(id);
            a.presence = 'not_installed'; a.docked = false; a.away = false;
          } else if (e.presence === 'sleeping') {
            if (a.docked) await wakeTarget(id);
            a.presence = 'sleeping'; a.mood = 'sleepy';
            layer.setMood(id, 'sleepy');
            await layer.play(id, 'Yawn', { once: true });
            await layer.play(id, 'Sleep');
          } else if (e.presence === 'docked') {
            a.presence = 'docked';
            await layer.moveTo(id, layout.hubX, { gait: 'sleepwalk' });
            await layer.dockInto(id, layout.dockPoint);
            a.docked = true;
          } else {
            a.presence = 'active'; a.away = false;
            if (a.docked) {
              if (id === 'eagle') await layer.flyIn(id, a.home);
              else await layer.undock(id, a.home);
              a.docked = false;
            } else if (previous === 'sleeping') {
              a.mood = 'neutral'; layer.setMood(id, 'neutral');
              await layer.play(id, 'WakeUp', { once: true });
            } else if (previous === 'not_installed' || e.reason === 'startup') {
              layer.spawn(id, a.home);
              await layer.play(id, 'Greet', { once: true });
            }
            await loop(id);
          }
        });
        break;
      case 'job.update':
        if (e.state === 'running' && e.requestedBy !== 'chipmunk') {
          queue([e.requestedBy, e.to], async () => {
            await wakeTarget(e.requestedBy);
            if (agents[e.requestedBy].away) return;
            await layer.moveTo(e.requestedBy, agents[e.to].home + (agents[e.requestedBy].home < agents[e.to].home ? -60 : 60), { gait: 'walk' });
            if (disposed) return;
            await wait(1000);
            if (disposed) return;
            await layer.moveTo(e.requestedBy, agents[e.requestedBy].home, { gait: 'walk' });
            await loop(e.requestedBy);
          });
        }
        break;
      case 'nudge.fire':
        queue(['chipmunk'], async () => {
          await wakeTarget('chipmunk');
          await layer.moveTo('chipmunk', layout.centerX, { gait: 'walk' });
          if (disposed) return;
          const nudge = layer.play('chipmunk', 'Nudge', { once: true });
          await nudge;
          if (disposed) return;
          await wait(3000);
          if (disposed) return;
          await layer.moveTo('chipmunk', agents.chipmunk.home, { gait: 'walk' });
          await loop('chipmunk');
        });
        break;
      case 'tool.request':
        calls.set(e.callId, id);
        if (e.risk === 'write' || e.risk === 'destructive' || e.risk === 'external') {
          queue(['wolf'], async () => {
            faceToward('wolf', xOf(id));
            await layer.play('wolf', 'Guard', { once: true });
            await loop('wolf');
          });
        }
        break;
      case 'wolf.verdict':
        if (e.verdict !== 'allow') {
          queue(['wolf'], async () => {
            const target = calls.get(e.callId) ?? id;
            if (e.verdict === 'ask') {
              await layer.moveTo('wolf', xOf(target) + (agents.wolf.home < xOf(target) ? -60 : 60), { gait: 'walk' });
              await layer.play('wolf', 'Sit');
            } else {
              await layer.moveTo('wolf', xOf(target), { gait: 'run' });
              if (disposed) return;
              const block = layer.play('wolf', 'Block', { once: true });
              await block;
              if (disposed) return;
              agents.wolf.mood = 'protective';
              layer.setMood('wolf', 'protective');
              await wait(2000);
              if (disposed) return;
              await layer.moveTo('wolf', agents.wolf.home, { gait: 'walk' });
              await loop('wolf');
            }
          });
        }
        break;
      case 'wolf.alert':
        queue(['wolf'], async () => {
          await layer.play('wolf', 'Howl', { once: true });
          ui.showBubble('wolf', e.reason.length > 64 ? `${e.reason.slice(0, 61)}…` : e.reason, 'warning');
          agents.wolf.bubble = null;
          await loop('wolf');
        });
        break;
      case 'approval.request':
        ui.showApproval({ callId: e.callId, title: e.title, preview: e.preview, nearAgent: 'wolf' });
        break;
      case 'approval.resolve':
        queue(['wolf'], async () => {
          ui.closeApproval(e.callId);
          calls.delete(e.callId);
          await layer.moveTo('wolf', agents.wolf.home, { gait: 'walk' });
          await loop('wolf');
        });
        break;
      case 'tool.result':
        calls.delete(e.callId);
        queue([id], () => ui.puff(id, e.ok));
        break;
      case 'artifact':
        queue([id], () => ui.flyToHub(id, e.title));
        break;
    }
  }

  const offStart = speech.onStart(item => {
    const id = speechOwners.get(item);
    if (!id) return;
    speaking.add(item);
    queue([id], () => layer.play(id, id === 'chipmunk' && item.mood === 'happy' ? 'TalkHappy' : id === 'chipmunk' && item.mood === 'scared' ? 'TalkScared' : 'Talk'));
  });
  const offEnd = speech.onEnd(item => {
    const id = speechOwners.get(item);
    if (id && speaking.has(item)) {
      speaking.delete(item);
      queue([id], () => loop(id));
    }
  });

  function flushLive(): void {
    for (const e of liveQueue.splice(0)) handleEvent(e);
  }

  function endReplay(): void {
    offDone?.(); offDone = null;
    player?.stop(); player = null;
    if (replaying) {
      replaying = false;
      ui.setReplayBanner(false);
      if (!disposed) flushLive();
    }
    finishReplay?.(); finishReplay = null;
  }

  return {
    get replaying() { return replaying; },
    handle(e) { if (disposed) return; if (replaying) liveQueue.push(e); else handleEvent(e); },
    async replay(taskId) {
      if (disposed || replaying) return;
      replaying = true;
      const token = ++replayToken;
      const finished = new Promise<void>(resolve => { finishReplay = resolve; });
      let events: BiomeEvent[] | null;
      try { events = await Promise.race([deps.getTaskEvents(taskId), finished.then(() => null)]); }
      catch (error) { if (token === replayToken) endReplay(); throw error; }
      if (token !== replayToken || disposed || events === null) return;
      if (events.length === 0) { endReplay(); return; }
      ui.setReplayBanner(true);
      player = deps.createPlayer();
      const first = events[0].ts;
      player.load(events.map(event => ({ atMs: event.ts - first, event })));
      player.setSpeed(2);
      offDone = player.onDone(endReplay);
      player.play(handleEvent);
      await finished;
    },
    stopReplay() { replayToken++; endReplay(); },
    setLayout(next: DesktopLayout) {
      layout = next;
      layer.setLayout(next);
      for (const id of IDS) {
        const a = agents[id];
        a.home = next.spots[id];
        queue([id], async () => {
          if (a.presence !== 'active' || a.status !== 'idle' || a.docked || a.away) return;
          await layer.moveTo(id, a.home, { gait: 'walk' });
          await loop(id);
        });
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      replayToken++;
      endReplay();
      offStart(); offEnd();
      for (const [handle, resolve] of timers) { clock.clearTimeout(handle); resolve(); }
      timers.clear();
      liveQueue.length = 0;
    },
  };
};
