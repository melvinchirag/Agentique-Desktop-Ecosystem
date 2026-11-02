import type { BiomeEvent } from './events';
import type { AgentId, AgentMood, ModelChoice } from './agents';

/** Exposed on window.ade by preload. Renderer → main. */
export interface AdeApi {
  sendMessage(text: string, source: 'text' | 'voice'): Promise<void>;
  sendVoice(audio: ArrayBuffer, mime: string): Promise<void>;                    // main: ElevenLabs STT (with audio-event cues) → orchestrator
  speak(agentId: AgentId, text: string, mood: AgentMood): Promise<ArrayBuffer>;  // ElevenLabs TTS (mp3)
  resolveApproval(callId: string, approved: boolean): Promise<void>;
  wakeAgent(agentId: AgentId): Promise<void>;                                     // Agent Hub dropdown
  sleepAgent(agentId: AgentId): Promise<void>;                                    // inspect card: Send to Hub
  setDoNotDisturb(on: boolean): Promise<void>;
  demoFireNudge(): Promise<void>;                                                 // demo hotkey Ctrl+Shift+N
  getSettings(): Promise<AdeSettings>;
  setSettings(patch: Partial<AdeSettings>): Promise<void>;
  connectGoogle(): Promise<{ email: string }>;
  disconnectGoogle(): Promise<void>;
  learnEmailStyle(): Promise<{ sampled: number }>;
  getTimeline(fromTs: number, toTs: number): Promise<BiomeEvent[]>;             // Tiger
  getTaskEvents(taskId: string): Promise<BiomeEvent[]>;                         // Tiger, for Replay
  getMemories(agentId: AgentId): Promise<{ id: string; memory: string }[]>;      // Backboard
  searchMemories(agentId: AgentId, q: string): Promise<{ id: string; memory: string }[]>;
  updateMemory(agentId: AgentId, memoryId: string, text: string): Promise<void>;
  deleteMemory(agentId: AgentId, memoryId: string): Promise<void>;
  getPulse(): Promise<object>;                                                    // Tiger: mood_daily + job_stats_daily + activity
  getWardenAudit(limit: number): Promise<object[]>;                              // Tiger: wolf_audit
  onEvent(cb: (e: BiomeEvent) => void): () => void;                             // main → renderer stream
}

export interface AdeSettings {
  historyEnabled?: boolean;        // Tiger configured; supplied by main, never user editable
  models: Record<AgentId, ModelChoice>;
  voiceEnabled: boolean;
  sfxEnabled?: boolean;
  ambienceEnabled?: boolean;
  allowedFolders: string[];      // Beaver's sandbox
  googleEmail?: string;
  styleLearnedAt?: number;
  biome: 'forest';               // 'desert' | 'snow' later
  demoMode: boolean;             // replay a recorded session if the network dies; short timers
  installed: Record<AgentId, boolean>;
  timers: { sleepAfterSec: number; dockAfterSec: number; moodDecaySec: number };   // default 180 / 600 / 20; demo 30 / 60 / 20
  nudges: { enabled: boolean; quietStart: string; quietEnd: string; maxPerHour: number };  // '23:00', '08:00', 3
}

export const IPC = {
  sendMessage: 'ade:send-message', sendVoice: 'ade:send-voice', speak: 'ade:speak',
  resolveApproval: 'ade:approval', getSettings: 'ade:settings:get', setSettings: 'ade:settings:set',
  wakeAgent: 'ade:hub:wake', sleepAgent: 'ade:hub:sleep', setDoNotDisturb: 'ade:hub:dnd', demoFireNudge: 'ade:demo:nudge',
  connectGoogle: 'ade:google:connect', disconnectGoogle: 'ade:google:disconnect', learnEmailStyle: 'ade:google:learn-style',
  getTimeline: 'ade:tiger:timeline', getTaskEvents: 'ade:tiger:task', getMemories: 'ade:bb:memories',
  deleteMemory: 'ade:bb:memory-delete', searchMemories: 'ade:bb:memory-search', updateMemory: 'ade:bb:memory-update',
  getPulse: 'ade:tiger:pulse', getWardenAudit: 'ade:tiger:audit', event: 'ade:event',
} as const;
