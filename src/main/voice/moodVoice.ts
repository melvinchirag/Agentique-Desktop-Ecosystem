import type { AgentMood } from '../../shared/agents';

export interface MoodVoice {
  /** Audio tag put in front of the line (the LLM never writes tags). Empty = none. */
  tag: string;
  stability: number;
  style: number;
  speed: number;
}

/**
 * Emotion → voice, for every animal (docs/SPONSORS.md §3.3).
 * Every tag here was accepted by eleven_v4_turbo and not read aloud (docs/sponsor-verify.md §E1).
 * `sleepy` is not in the plan's table; it uses the neutral settings.
 */
export const MOOD_VOICE: Record<AgentMood, MoodVoice> = {
  neutral:    { tag: '',            stability: 0.5,  style: 0.4,  speed: 1.0 },
  happy:      { tag: '[cheerful]',  stability: 0.45, style: 0.55, speed: 1.03 },
  excited:    { tag: '[excited]',   stability: 0.3,  style: 0.7,  speed: 1.08 },
  proud:      { tag: '[confident]', stability: 0.55, style: 0.5,  speed: 1.0 },
  nervous:    { tag: '[nervous]',   stability: 0.35, style: 0.6,  speed: 1.05 },
  scared:     { tag: '[nervous]',   stability: 0.3,  style: 0.7,  speed: 1.1 },
  sad:        { tag: '[sad]',       stability: 0.65, style: 0.3,  speed: 0.92 },
  protective: { tag: '[serious]',   stability: 0.8,  style: 0.3,  speed: 0.95 },
  relieved:   { tag: '[sighs]',     stability: 0.5,  style: 0.5,  speed: 1.0 },
  sleepy:     { tag: '',            stability: 0.5,  style: 0.4,  speed: 1.0 },
};

export const moodVoice = (mood: AgentMood): MoodVoice => MOOD_VOICE[mood] ?? MOOD_VOICE.neutral;

/** "[excited] " + text, or just the text when the mood has no tag. */
export const tagPrefix = (mood: AgentMood): string => { const t = moodVoice(mood).tag; return t ? `${t} ` : ''; };
