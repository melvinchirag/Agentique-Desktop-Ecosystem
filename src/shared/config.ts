import type { AgentId, AgentProfile } from './agents';

export const AGENTS: Record<AgentId, AgentProfile> = {
  chipmunk:    { id: 'chipmunk',    displayName: 'Chip',  animal: 'chipmunk',    role: 'Your guide. Listens, reads the room, sends the right animal.', tier: 'core',  color: '#C8814A' },
  workspace:   { id: 'workspace',   displayName: 'Pixel',   animal: 'custom',      role: 'Google Workspace. Writes like you. Never sends.',            tier: 'core',  color: '#7A6A9E' },
  wolf:        { id: 'wolf',        displayName: 'Warden',   animal: 'wolf',        role: 'Guardian. Checks every action. Keeps the audit log.',        tier: 'core',  color: '#5B6770' },
  beaver:      { id: 'beaver',      displayName: 'Archie',   animal: 'beaver',      role: 'Files. Finds, sorts, and tidies. Every move can be undone.',  tier: 'core',  color: '#8B5A2B' },
  eagle:       { id: 'eagle',       displayName: 'Scout',   animal: 'eagle',       role: 'Web research and browsing, with sources.',                    tier: 'core',  color: '#D4A017' },
  ants:        { id: 'ants',        displayName: 'Swarm',   animal: 'ants',        role: 'Plans your day and breaks big goals into steps.',             tier: 'core',  color: '#A23B2A' },
  butterfly:   { id: 'butterfly',   displayName: 'Iris',   animal: 'butterfly',   role: 'Social posts in your voice. Never posts.',                    tier: 'extra', color: '#E26D9C' },
  nightingale: { id: 'nightingale', displayName: 'Celene',   animal: 'nightingale', role: 'Music that matches your mood.',                               tier: 'extra', color: '#4E8F7A' },
};
