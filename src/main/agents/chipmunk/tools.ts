import type { OpenAiTool, SpecialistId } from '../../runtime/types';
import { SPECIALIST_IDS } from './names';

/** Chip's five tools (spec §10.1–10.5). `ask_teammate` (§10.6) belongs to specialists, not Chip. */
export function chipTools(installed: SpecialistId[]): OpenAiTool[] {
  const agentEnum = SPECIALIST_IDS.filter((id) => installed.includes(id));

  return [
    {
      type: 'function',
      function: {
        name: 'report_user_mood',
        description:
          'Report how the user seems to feel right now. ALWAYS call this first on every user turn. Use the words, punctuation, and any voice_cues such as (sighs) or (laughter).',
        parameters: {
          type: 'object',
          properties: {
            mood: { type: 'string', enum: ['calm', 'happy', 'excited', 'stressed', 'angry', 'sad'] },
            intensity: { type: 'number', description: '0 to 1. 0.2 = barely, 0.5 = clearly, 0.9 = very strongly.' },
            reason: { type: 'string', description: "A few words, e.g. 'all caps, swearing'." },
          },
          required: ['mood', 'intensity', 'reason'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'delegate',
        description:
          'Start a job for one animal. Returns immediately; the animal reports back later in a [job_results] turn. Different animals work at the same time; one animal does one job at a time. The task must be self-contained: names, dates, email addresses, and facts from earlier results.',
        parameters: {
          type: 'object',
          properties: {
            agent: { type: 'string', enum: [...agentEnum] },
            task: { type: 'string', description: 'Complete instruction for the animal.' },
            title: { type: 'string', description: "2-5 word label shown in the Agent Hub, e.g. 'Pizza near campus'." },
            next_step: {
              type: 'string',
              description: "Optional. What you will do with the result, for chains, e.g. 'draft email to Melvin with the list'.",
            },
            plan_step: {
              type: 'integer',
              description: "Optional. The step number from Swarm's plan this job carries out. Shows as an ant carrying the task.",
            },
          },
          required: ['agent', 'task', 'title'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'cancel_jobs',
        description:
          "Cancel running and queued jobs. Give an agent to cancel only that animal's jobs; omit it to cancel everything.",
        parameters: {
          type: 'object',
          properties: {
            agent: { type: 'string', enum: [...agentEnum] },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'schedule_followup',
        description:
          'Remember to ask the user about something later, e.g. how an exam, interview, or game went. Pick a time shortly after it ends.',
        parameters: {
          type: 'object',
          properties: {
            question: { type: 'string', description: 'What to ask, in your voice.' },
            ask_at: {
              type: 'string',
              description: 'ISO 8601 date-time with timezone offset, e.g. 2026-10-08T18:00:00-04:00.',
            },
            about: { type: 'string', description: "2-5 words, e.g. 'Google interview'." },
          },
          required: ['question', 'ask_at', 'about'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'biome_history',
        description:
          "Look up what the biome did before. Use for 'what did you do for me today', 'what did Warden block', 'how have I been feeling'.",
        parameters: {
          type: 'object',
          properties: {
            kind: { type: 'string', enum: ['recent_tasks', 'warden_blocks', 'agent_activity', 'mood_history'] },
            since_hours: { type: 'number', description: 'How far back. Default 24.' },
            agent: { type: 'string', description: 'Optional animal id.' },
          },
          required: ['kind'],
        },
      },
    },
  ];
}
