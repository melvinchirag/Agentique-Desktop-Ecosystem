/**
 * Chip runtime interfaces (Chip spec v3.1 §7 + the plugs Shafeen implements).
 *
 * FROZEN after Wave 0 (01-chip-BUILD-LANES.md §3). A lane that needs a change STOPs and asks the
 * orchestrator; changes go through a PR into main that Chanuth approves.
 *
 * Nothing here imports Electron.
 */
import type { AgentId, AgentMood, ModelChoice, Presence, UserMood } from '../../shared/agents';
import type { ArtifactKind, BiomeEvent } from '../../shared/events';
import type { AdeSettings } from '../../shared/ipc';
import type { DistributiveOmit, Risk } from '../../shared/tools';

// ── Warden ────────────────────────────────────────────────────────────────────

export type WardenVerdict = 'allow' | 'ask' | 'deny';
export interface GateRequest {
  agentId: AgentId; taskId: string; callId: string; tool: string; risk: Risk;
  jobId: string; jobKind: 'normal' | 'help'; args: unknown;
}
export interface WardenGate {
  /** Sync. Emits wolf.verdict; failures are reported as deny with rule W0. */
  review(r: GateRequest): WardenVerdict;
  explain?(callId: string): { rule: string; reason: string } | undefined;
}

export type ApprovalHow = 'user' | 'timeout' | 'cancelled';
export interface ApprovalOutcome { approved: boolean; how: ApprovalHow }
export interface ApprovalRequest {
  callId: string; jobId: string; taskId: string; agentId: AgentId;
  title: string; preview: string; signal: AbortSignal;
}
export interface Approvals {
  request(r: ApprovalRequest): Promise<ApprovalOutcome>;
  resolve(callId: string, approved: boolean): void;
  cancelForJobs(jobIds: string[]): void;
  pending(): { callId: string; jobId: string; agentId: AgentId; title: string; expiresAt: number }[];
  dispose(): void;
}

export interface ScreenSource { kind: 'email' | 'file' | 'doc' | 'calendar' | 'web' | 'summary'; name: string; taskId?: string; jobId?: string }
export interface ScreenResult { flagged: boolean; score: number; reasons: string[]; wrapped: string }
export interface InjectionScreen { screen(text: string, source: ScreenSource): Promise<ScreenResult> }

// ── Ids ───────────────────────────────────────────────────

/** Animals Chip can hand jobs to. Chip is the orchestrator; Warden is never delegated to. */
export type SpecialistId = Exclude<AgentId, 'chipmunk' | 'wolf'>;

// ── Clock (injectable so tests can fast-forward) ──────────

export type TimerHandle = unknown;
export interface Clock {
  now(): number;                                        // epoch ms
  setTimeout(fn: () => void, ms: number): TimerHandle;
  clearTimeout(h: TimerHandle): void;
}

// ── EventBus ──────────────────────────────────────────────

/** What callers pass to emit(); the bus fills id, ts, sessionId. */
export type BiomeEventInput = DistributiveOmit<BiomeEvent, 'id' | 'ts' | 'sessionId'>;
export interface Bus {
  readonly sessionId: string;
  /** Fills id/ts/sessionId, stores it in the ring buffer, fans out synchronously, returns the full event. */
  emit(e: BiomeEventInput): BiomeEvent;
  /** Returns an unsubscribe function. A throwing subscriber never stops the others. */
  subscribe(cb: (e: BiomeEvent) => void): () => void;
  /** Most recent events, oldest first (ring of 500). `limit` returns only the newest N. */
  recent(limit?: number): BiomeEvent[];
}

// ── Backboard ─────────────────────────────────────────────

export type OpenAiTool = { type: 'function'; function: { name: string; description: string; parameters: object } };

export interface SendParams {
  assistantId: string; threadId?: string; content: string;
  systemPrompt?: string;                       // per-turn override
  tools?: OpenAiTool[]; model?: ModelChoice;
  memory?: 'Auto' | 'Readonly' | 'off'; webSearch?: 'Auto' | 'off'; jsonOutput?: boolean;
  signal?: AbortSignal; timeoutMs?: number;    // default 25_000
}
export interface LlmToolCall { id: string; type: 'function'; function: { name: string; arguments: string } }
export interface LlmResponse {
  status?: 'IN_PROGRESS' | 'REQUIRES_ACTION' | 'COMPLETED' | 'FAILED' | 'CANCELLED' | null;
  thread_id: string; content?: string | null;
  /** Actual serving model reported by Backboard, which can differ from the requested model. */
  model_provider?: string | null; model_name?: string | null;
  tool_calls?: LlmToolCall[] | null;
  /** Memory texts Backboard used for this answer, normalized by the LlmClient (raw shape: see the S1 spike). Non-empty → emit agent.recall. */
  retrieved_memories?: string[] | null;
}
export interface LlmClient {
  send(p: SendParams): Promise<LlmResponse>;
  submitToolOutputs(threadId: string, outputs: { tool_call_id: string; output: string }[], signal?: AbortSignal, model?: ModelChoice): Promise<LlmResponse>;
}

// ── Specialists ───────────────────────────────────────────

export interface AgentResult { ok: boolean; say: string; bubble: string; summary: string; artifacts: { kind: ArtifactKind; title: string }[] }
export interface SpecialistRunContext { jobId: string; taskId: string; kind: 'normal' | 'help'; signal: AbortSignal }
export interface SpecialistRunner {
  /** Help jobs (kind 'help') must run WITHOUT ask_teammate in their tool list (depth limit 1). */
  run(agentId: SpecialistId, task: string, ctx: SpecialistRunContext): Promise<AgentResult>;
}

// ── Jobs ──────────────────────────────────────────────────

export type JobState = 'queued' | 'running' | 'done' | 'failed' | 'cancelled';
export interface Job {
  jobId: string; agent: SpecialistId; task: string; title: string;          // title: 2–5 words, for Hub + bubbles
  requestedBy: AgentId;                  // 'chipmunk', or the asking animal for help jobs
  kind: 'normal' | 'help';
  parentTaskId: string;                  // the user request it belongs to (for Replay + result turns)
  nextStep?: string;                     // Chip's plan for when this finishes (chains)
  planStep?: number;                     // Swarm plan step this job carries out → handoff via: 'ants'
  state: JobState;
  position?: number;                     // place in line when queued (1 = next)
  startedAt?: number; finishedAt?: number;
}
export type SubmitStatus = 'started' | 'woke_and_started' | 'queued' | 'duplicate' | 'not_installed';
export interface JobRequest {
  agent: SpecialistId; task: string; title: string; requestedBy: AgentId; kind: 'normal' | 'help';
  parentTaskId: string; nextStep?: string; planStep?: number;
}
export interface JobScheduler {
  submit(j: JobRequest): { status: SubmitStatus; jobId?: string; position?: number };
  waitFor(jobId: string): Promise<AgentResult>;          // used by ask_teammate
  cancel(filter: { agent?: SpecialistId; all?: true }): number;
  list(): Job[];
  onFinished(cb: (job: Job, result: AgentResult) => void): void;
  pauseClock(jobId: string): void; resumeClock(jobId: string): void;   // called around Warden approvals
}

// ── Presence ──────────────────────────────────────────────

export interface PresenceManager {
  /** Startup: every installed animal → active (reason 'startup'); arms idle timers. */
  start(): void;
  get(id: AgentId): Presence;
  touch(id: AgentId): void;                               // resets that animal's idle timer
  /** While busy (running a job, or Chip mid-turn) the idle timers are held; setBusy(id, false) restarts them. */
  setBusy(id: AgentId, busy: boolean): void;
  wake(id: AgentId, reason: 'user' | 'job'): Promise<void>; // resolves when the animal is back in the biome (max 3 s)
  onChange(cb: (id: AgentId, p: Presence) => void): void;
  dispose(): void;                                        // clears all timers
}

// ── Mood ──────────────────────────────────────────────────

export interface MoodEngine {
  /** Chip spec §15. The caller has already emitted user.mood; this emits agent.mood events (Chip now, contagion, decay). */
  onUserMood(mood: UserMood, intensity: number, reason: string, taskId?: string): void;
  /** Last reported user mood (for [context] user_mood_before and acks). Starts 'calm'. */
  getUserMood(): UserMood;
  dispose(): void;                                        // clears contagion/decay timers
}

// ── Nudges ────────────────────────────────────────────────

export type NudgeKind = 'before' | 'after' | 'daily' | 'evening' | 'weekly' | 'custom';
export type NudgeState = 'pending' | 'fired' | 'answered' | 'snoozed' | 'cancelled';
export interface Nudge {
  id: string; kind: NudgeKind; about: string; question: string; askAt: Date; eventId?: string;
  state: NudgeState; source: 'planner' | 'chip' | 'rule';
}
export interface NudgeEngine {
  /** Starts the 30 s check loop, rule nudges, and the planner. */
  start(): void;
  schedule(n: Omit<Nudge, 'id' | 'state'>): string;
  cancel(id: string): void; snooze(id: string, minutes: number): void;
  markAnswered(id: string): void;
  fireNextNow(): void;                                    // demo hotkey
  onDue(cb: (batch: Nudge[]) => void): void;              // fires only when allowed (§14.4); batch = merged nudges
  dispose(): void;                                        // stops the loop
}
export interface NudgeStore {                           // in-memory (Melvin, Lane H) → Tiger (Shafeen, S5b)
  insert(n: Nudge): Promise<void>; update(id: string, patch: Partial<Nudge>): Promise<void>;
  due(now: Date): Promise<Nudge[]>; findByEvent(eventId: string, kind: NudgeKind): Promise<Nudge | null>;
}
export interface CalendarEvent { id: string; title: string; start: Date; end: Date }
export interface CalendarSource { listEvents(from: Date, to: Date): Promise<CalendarEvent[]> }  // Melvin's Google connector

// ── History ───────────────────────────────────────────────

export type HistoryKind = 'recent_tasks' | 'warden_blocks' | 'agent_activity' | 'mood_history';
export interface HistoryStore { query(kind: HistoryKind, sinceHours: number, agent?: AgentId): Promise<object[]> }

// ── File operations (Archie) ─────────────────────────────

/** One undoable filesystem operation. The local journal is primary; Tiger stores a copy. */
export interface FileOp {
  id: string;
  ts: number;
  jobId: string;
  batchId: string;
  op: 'move' | 'rename' | 'mkdir' | 'trash' | 'sweep';
  fromPath?: string;
  toPath?: string;
  undone: boolean;
  swept?: boolean;
}

export interface FileOpsJournal {
  record(op: FileOp): Promise<void>;
  lastBatch(): Promise<string | null>;
  batchOps(batchId: string): Promise<FileOp[]>;
  markUndone(batchId: string): Promise<void>;
  recent(sinceHours: number): Promise<FileOp[]>;
  trashBatchesOlderThan(days: number): Promise<string[]>;
  markSwept(batchId: string): Promise<void>;
}

// ── Sponsor pieces built by Shafeen (agents/01-chip-SPONSOR-LANES-SHAFEEN.md) ──

export interface EventSink { enqueue(e: BiomeEvent): void; flush(): Promise<void> }                       // Tiger writer; subscribed to the bus
export interface Memory { id: string; content: string; created_at?: string; updated_at?: string }
export interface MemoryApi {
  list(agentId: AgentId): Promise<Memory[]>; search(agentId: AgentId, q: string): Promise<Memory[]>;
  update(agentId: AgentId, id: string, text: string): Promise<void>; remove(agentId: AgentId, id: string): Promise<void>;
}
export interface MemoryWriter { add(agentId: AgentId, text: string): Promise<{ id: string }> }
export interface DraftRecord { gmailDraftId: string; ts: number; toCount: number; subject: string; state: 'waiting' | 'sent' | 'deleted' }
export interface DraftsLog {
  record(d: Omit<DraftRecord, 'state'>): Promise<void>;
  setState(gmailDraftId: string, state: 'sent' | 'deleted'): Promise<void>;
  waiting(olderThanMs: number): Promise<DraftRecord[]>;
}
export interface TigerQueries { taskEvents(taskId: string): Promise<BiomeEvent[]>; wardenAudit(limit: number): Promise<object[]>; pulse(): Promise<object> }
/** Backboard thread-document API used by Archie's fs_ask_file tool. */
export interface DocumentsApi {
  uploadToThread(threadId: string, absPath: string): Promise<{ documentId: string }>;
  waitIndexed(documentId: string, timeoutMs: number): Promise<{ status: 'indexed' | 'error'; chunks: number }>;
}
export interface VoiceService {
  speak(agentId: AgentId, text: string, mood: AgentMood): Promise<{ audio: ArrayBuffer; alignment?: object }>;
  transcribe(audio: ArrayBuffer, mime: string): Promise<{ text: string; cues: string[] }>;
  pregenerate(lines: { agentId: AgentId; text: string; mood?: AgentMood }[]): Promise<void>;
}

// ── Orchestrator (Lane G builds it; Lane I drives it) ─────

export interface OrchestratorDeps {
  bus: Bus;
  clock: Clock;
  llm: LlmClient;
  jobs: JobScheduler;
  presence: PresenceManager;
  mood: MoodEngine;
  nudges: NudgeEngine;
  history: HistoryStore;
  settings: () => AdeSettings;
  chipAssistantId: string;
  /** IANA zone for the [context] "now:" line, e.g. 'America/Detroit'. Default: the system zone. */
  timeZone?: string;
}
export interface Orchestrator {
  /** Queues a user message (typed or transcribed). Returns at once; the turn runs from the inbox. */
  submitUserMessage(text: string, opts?: { source?: 'text' | 'voice'; voiceCues?: string[] }): void;
  /** Resolves when the inbox is empty and no Chip turn is running (tests + chip-cli). */
  whenIdle(): Promise<void>;
  dispose(): void;
}
