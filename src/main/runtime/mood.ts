import type { AgentId, AgentMood, UserMood } from '../../shared/agents';
import { AGENTS } from '../../shared/config';
import type { AdeSettings } from '../../shared/ipc';
import type { Bus, Clock, MoodEngine, PresenceManager, TimerHandle } from './types';

export interface MoodDeps { bus: Bus; clock: Clock; settings: () => AdeSettings; presence: PresenceManager }

export const CONTAGION_DELAY_MS = 400;
export const CONTAGION_STAGGER_MS = 250;
export const CONTAGION_ORDER: AgentId[] = ['workspace', 'wolf', 'beaver', 'eagle', 'ants', 'butterfly', 'nightingale'];

type MoodRow = Record<AgentId, AgentMood>;

const NORMAL: Record<UserMood, MoodRow> = {
  angry: { chipmunk: 'scared', workspace: 'nervous', wolf: 'protective', beaver: 'scared', eagle: 'nervous', ants: 'scared', butterfly: 'scared', nightingale: 'scared' },
  stressed: { chipmunk: 'nervous', workspace: 'nervous', wolf: 'protective', beaver: 'nervous', eagle: 'neutral', ants: 'nervous', butterfly: 'nervous', nightingale: 'nervous' },
  sad: { chipmunk: 'sad', workspace: 'sad', wolf: 'protective', beaver: 'sad', eagle: 'sad', ants: 'sad', butterfly: 'sad', nightingale: 'sad' },
  happy: { chipmunk: 'happy', workspace: 'happy', wolf: 'proud', beaver: 'happy', eagle: 'proud', ants: 'happy', butterfly: 'happy', nightingale: 'happy' },
  excited: { chipmunk: 'excited', workspace: 'excited', wolf: 'proud', beaver: 'excited', eagle: 'proud', ants: 'excited', butterfly: 'excited', nightingale: 'excited' },
  calm: { chipmunk: 'neutral', workspace: 'neutral', wolf: 'neutral', beaver: 'neutral', eagle: 'neutral', ants: 'neutral', butterfly: 'neutral', nightingale: 'neutral' },
};

const RELIEF: MoodRow = {
  chipmunk: 'relieved', workspace: 'happy', wolf: 'proud', beaver: 'happy', eagle: 'happy', ants: 'happy', butterfly: 'happy', nightingale: 'happy',
};

export function createMoodEngine(deps: MoodDeps): MoodEngine {
  const current = new Map<AgentId, AgentMood>(Object.keys(AGENTS).map((id) => [id as AgentId, 'neutral']));
  let userMood: UserMood = 'calm';
  let contagionTimer: TimerHandle | undefined;
  let decayTimer: TimerHandle | undefined;
  let disposed = false;

  function cancel(handle: TimerHandle | undefined): void {
    if (handle !== undefined) deps.clock.clearTimeout(handle);
  }

  function setMood(id: AgentId, mood: AgentMood, intensity: number, cause: AgentId | 'user', taskId?: string): void {
    if (current.get(id) === mood) return;
    current.set(id, mood);
    deps.bus.emit({ type: 'agent.mood', agentId: id, mood, intensity, cause, ...(taskId === undefined ? {} : { taskId }) });
  }

  return {
    onUserMood(mood, intensity, _reason, taskId): void {
      if (disposed) return;
      cancel(contagionTimer);
      cancel(decayTimer);
      contagionTimer = undefined;
      decayTimer = undefined;

      const relief = (mood === 'calm' || mood === 'happy') && (userMood === 'angry' || userMood === 'stressed');
      const row = relief ? RELIEF : NORMAL[mood];
      userMood = mood;
      setMood('chipmunk', row.chipmunk, intensity, 'user', taskId);

      if (intensity >= 0.3 || relief) {
        let index = 0;
        const visitNext = (): void => {
          if (disposed) return;
          contagionTimer = undefined;
          while (index < CONTAGION_ORDER.length) {
            const id = CONTAGION_ORDER[index++];
            if (deps.settings().installed[id] !== true || deps.presence.get(id) !== 'active') continue;
            setMood(id, row[id], intensity, 'chipmunk', taskId);
            if (index < CONTAGION_ORDER.length) contagionTimer = deps.clock.setTimeout(visitNext, CONTAGION_STAGGER_MS);
            return;
          }
          contagionTimer = undefined;
        };
        contagionTimer = deps.clock.setTimeout(visitNext, CONTAGION_DELAY_MS);
      }

      decayTimer = deps.clock.setTimeout(() => {
        decayTimer = undefined;
        for (const [id, agentMood] of current) {
          if (agentMood !== 'neutral') setMood(id, 'neutral', intensity, 'user', taskId);
        }
        contagionTimer = undefined;
      }, deps.settings().timers.moodDecaySec * 1000);
    },

    getUserMood(): UserMood { return userMood; },

    dispose(): void {
      if (disposed) return;
      disposed = true;
      cancel(contagionTimer);
      cancel(decayTimer);
      contagionTimer = undefined;
      decayTimer = undefined;
    },
  };
}
