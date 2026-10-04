import type { AgentId } from './agents';
import type { BiomeEvent } from './events';

/** Wolf uses this to decide what needs approval. */
export type Risk =
  | 'read'         // look only
  | 'draft'        // creates something the user must still act on (Gmail draft, post text)
  | 'write'        // changes the user's stuff (move file, create calendar event)
  | 'destructive'  // removes things (trash a file)
  | 'external';    // sends/posts/pays on the user's behalf. NO TOOL MAY HAVE THIS. Wolf denies it.

/** Details a tool knows about a call that Warden cannot infer from its arguments alone. */
export interface ToolInspection {
  paths?: string[];
  writesPaths?: string[];
  count?: number;
  urls?: string[];
  attachments?: string[];
  hasAttendees?: boolean;
}

export interface ToolContext {
  agentId: AgentId;
  taskId: string;
  jobId: string;
  sessionId: string;
  threadId: string;
  emit: (e: DistributiveOmit<BiomeEvent, 'id' | 'ts' | 'sessionId'>) => void;
  signal: AbortSignal;
}

export interface ToolDefinition<I = any, O = any> {
  name: string;                       // snake_case, unique across all agents, prefixed: gmail_, cal_, fs_, web_, social_, music_, plan_
  description: string;                // written for the LLM
  parameters: Record<string, unknown>;// JSON Schema (OpenAI function format) — sent to Backboard as-is
  risk: Risk;
  /** Optional dynamic risk escalation, e.g. bulk file moves, events with attendees. */
  riskFor?: (input: I) => Risk;
  /** Synchronous, side-effect-free details for Warden's review. */
  inspect?: (input: I) => ToolInspection;
  /** Human-readable preview for Wolf's approval card. Required when risk can be write/destructive. */
  preview?: (input: I) => string;
  execute: (input: I, ctx: ToolContext) => Promise<O>;
}

export interface AgentDefinition {
  id: AgentId;
  systemPrompt: string;               // loaded from prompt.md
  tools: ToolDefinition[];
  maxToolRounds: number;              // default 8
  webSearch?: boolean;                // Backboard web_search: 'Auto' (Scout)
}

export type DistributiveOmit<T, K extends keyof any> = T extends any ? Omit<T, K> : never;
