export type AgentId =
  | 'chipmunk' | 'workspace' | 'wolf' | 'beaver' | 'eagle' | 'ants'   // core six
  | 'butterfly' | 'nightingale';                                       // extras (start asleep)

export type AgentStatus =
  | 'idle' | 'listening' | 'thinking' | 'working' | 'away'      // away = off-screen on a job (e.g. Scout flying)
  | 'speaking' | 'waiting_approval' | 'done' | 'error';

/** Where the animal is. Separate from status (what it's doing). */
export type Presence = 'active' | 'sleeping' | 'docked' | 'not_installed';

/** How an animal feels. Drives color tint, animation style, and voice settings. */
export type AgentMood =
  | 'neutral' | 'happy' | 'excited' | 'proud'
  | 'nervous' | 'scared' | 'sad' | 'protective' | 'sleepy' | 'relieved';

/** How Chip reads the user. */
export type UserMood = 'calm' | 'happy' | 'excited' | 'stressed' | 'angry' | 'sad';

export interface ModelChoice {
  llm_provider: string;   // Backboard provider id, e.g. 'openai' | 'anthropic' | 'google'
  model_name: string;     // e.g. 'gpt-4o', 'claude-sonnet-4-20250514'
}

export interface AgentProfile {
  id: AgentId;
  displayName: string;    // 'Chip', ... (names TBD)
  animal: string;
  role: string;           // one line, shown on hover
  tier: 'core' | 'extra';
  color: string;          // base accent color (hex)
}
