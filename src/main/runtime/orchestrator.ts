import { randomUUID } from 'node:crypto';
import type { AgentId, UserMood } from '../../shared/agents';
import { AGENTS } from '../../shared/config';
import { pickAck } from '../agents/chipmunk/acks';
import { SPECIALIST_IDS, nameOf, specialistFromWord } from '../agents/chipmunk/names';
import { parseChipOutput } from '../agents/chipmunk/parse';
import { pseudoMoodArgs } from './sanitizeLlmText';
import {
  buildNudgeTurn, buildResultTurn, buildUserTurn, chipSystemPrompt, type ChipContextState, type ResultItem,
} from '../agents/chipmunk/prompt';
import { chipTools } from '../agents/chipmunk/tools';
import { ANSWER_WINDOW_MS } from './nudges';
import type {
  AgentResult, HistoryKind, Job, LlmResponse, LlmToolCall, Nudge, Orchestrator, OrchestratorDeps, SpecialistId, TimerHandle,
} from './types';

/**
 * Chip's inbox and turn loop (Chip spec §8, §9, §10, §12, §13, §14.3).
 * - Three queues, always drained user → results → nudges; one Chip turn at a time.
 * - Chip jobs that finish within RESULT_BATCH_MS of each other (same parentTaskId) become one result turn.
 * - The loop never dies: every failure inside a turn ends in the foggy line.
 */

export interface OrchestratorOptions {
  newId?: () => string;                 // default crypto.randomUUID (taskIds)
  llmTimeoutMs?: number;                // default 25_000
}

export const RESULT_BATCH_MS = 1500;
export const MAX_TOOL_ROUNDS = 6;
export const TOOL_OUTPUT_MAX_CHARS = 12_000;
export const FOGGY_LINE = "My brain's a bit foggy. Say that again?";
export const PARTWAY_LINE = 'I got partway. Want me to keep going?';

const DEFAULT_LLM_TIMEOUT_MS = 25_000;
const RECENT_RESULTS_MAX = 5;
const REQUESTS_MAX = 100;              // original request text kept per taskId, oldest dropped first
const STOP_MAX_WORDS = 4;
const SNOOZE_MINUTES = 120;
const DEFAULT_SINCE_HOURS = 24;

const STOP_RE = /^(?:stop|cancel|never\s+mind|nvm)(?![\p{L}\p{N}'])/iu;
const SNOOZE_RE = /^(later|not now|maybe later|remind me later)\b/i;
const STOP_ASKING_RE = /stop asking/i;

/** Route clear external-information requests even if Chip's model skips its delegation tool. */
function requiredSpecialist(text: string): SpecialistId | undefined {
  if (!/\b(find|show|list|open|read|check|search|look up|what|which|where|latest|newest)\b/i.test(text)) return undefined;
  if (/\b(files?|folders?|downloads?|downloaded|desktop|documents|pdfs?|on my computer)\b/i.test(text)) return 'beaver';
  if (/\b(emails?|inbox|gmail)\b/i.test(text)) return 'workspace';
  if (/\b(web|websites?|internet|online|news|sources?|facts?|weather|research|scout)\b/i.test(text)) return 'eagle';
  return undefined;
}

/** "Let me send Scout…" with no tool call: the model promised to act but did not. */
const PROMISE_ONLY = /\b(?:let me|i'?ll|i will|i'?m going to|sending|on it)\b[^.!?\n]{0,60}\b(?:send|ask|get|fetch|check|look|find|have|dispatch)\b/i;

const USER_MOODS: readonly UserMood[] = ['calm', 'happy', 'excited', 'stressed', 'angry', 'sad'];
const HISTORY_KINDS: readonly HistoryKind[] = ['recent_tasks', 'warden_blocks', 'agent_activity', 'mood_history'];
const AGENT_IDS = Object.keys(AGENTS) as AgentId[];

// ── Inbox items ───────────────────────────────────────────

interface FinishedJob { job: Job; result: AgentResult }
interface PendingBatch { finished: FinishedJob[]; timer: TimerHandle }
/** The last nudge batch; a user reply only counts as its answer once Chip's nudge turn has started. */
interface NudgeBatchRecord { ids: string[]; firedAt: number; asked: boolean }

type InboxItem =
  | { kind: 'user'; text: string; source: 'text' | 'voice'; voiceCues: string[] }
  | { kind: 'result'; taskId: string; finished: FinishedJob[] }
  | { kind: 'nudge'; batch: Nudge[]; record: NudgeBatchRecord };

interface Turn {
  kind: InboxItem['kind'];
  taskId: string;
  moodReported: boolean;
  acked: boolean;
  actionAttempted: boolean;
  delegationSucceeded: boolean;
  recalled: Set<string>;
}

/** `llm.send` / `submitToolOutputs` failed (after the client's own retry) or Backboard reported FAILED/CANCELLED. */
class LlmFailure extends Error {}

type ToolArgs = Record<string, unknown>;
type Executor = (args: ToolArgs, turn: Turn) => unknown;

export function createOrchestrator(deps: OrchestratorDeps, opts: OrchestratorOptions = {}): Orchestrator {
  const { bus, clock, llm, jobs, presence, mood, nudges, history, settings, chipAssistantId } = deps;
  const newId = opts.newId ?? randomUUID;
  const llmTimeoutMs = opts.llmTimeoutMs ?? DEFAULT_LLM_TIMEOUT_MS;
  const timeZone = deps.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;

  const userQ: Extract<InboxItem, { kind: 'user' }>[] = [];
  const resultQ: Extract<InboxItem, { kind: 'result' }>[] = [];
  const nudgeQ: Extract<InboxItem, { kind: 'nudge' }>[] = [];
  const pendingResults = new Map<string, PendingBatch>();
  const recentResults: ChipContextState['recentResults'] = [];
  const requests = new Map<string, string>();
  const idleWaiters: (() => void)[] = [];

  let chipThreadId: string | undefined;
  let lastNudge: NudgeBatchRecord | undefined;
  let draining = false;
  let disposed = false;

  // The foggy sad mood is emitted here, not by the MoodEngine, so the engine's decay never resets it.
  // We reset it ourselves after moodDecaySec, unless Chip's mood changed in the meantime.
  let lastChipMoodId: string | undefined;
  const foggyTimers = new Set<TimerHandle>();
  const unsubscribe = bus.subscribe((e) => {
    if (e.type === 'agent.mood' && e.agentId === 'chipmunk') lastChipMoodId = e.id;
  });

  // ── Wiring ──────────────────────────────────────────────

  jobs.onFinished((job, result) => {
    if (disposed || job.requestedBy !== 'chipmunk') return;    // help jobs go back to the animal that asked

    recentResults.push({ agent: job.agent, finishedAt: job.finishedAt ?? clock.now(), summary: result.summary });
    if (recentResults.length > RECENT_RESULTS_MAX) recentResults.shift();

    const taskId = job.parentTaskId;
    const pending: PendingBatch = pendingResults.get(taskId) ?? { finished: [], timer: undefined };
    if (pending.timer !== undefined) clock.clearTimeout(pending.timer);
    pending.finished.push({ job, result });
    pending.timer = clock.setTimeout(() => {
      pendingResults.delete(taskId);
      if (disposed) return;
      resultQ.push({ kind: 'result', taskId, finished: pending.finished });
      kick();
    }, RESULT_BATCH_MS);
    pendingResults.set(taskId, pending);
  });

  nudges.onDue((batch) => {
    if (disposed || batch.length === 0) return;
    const record: NudgeBatchRecord = { ids: batch.map((n) => n.id), firedAt: clock.now(), asked: false };
    lastNudge = record;
    nudgeQ.push({ kind: 'nudge', batch, record });
    kick();
  });

  // ── Loop ────────────────────────────────────────────────

  const queuesEmpty = (): boolean => userQ.length === 0 && resultQ.length === 0 && nudgeQ.length === 0;
  const nextItem = (): InboxItem | undefined => userQ.shift() ?? resultQ.shift() ?? nudgeQ.shift();

  function settleIdle(): void {
    if (draining || !queuesEmpty()) return;
    for (const resolve of idleWaiters.splice(0)) resolve();
  }

  function kick(): void {
    if (draining || disposed) return;
    draining = true;
    void drain();
  }

  async function drain(): Promise<void> {
    try {
      await Promise.resolve();                                   // callers return before the turn starts
      for (let item = nextItem(); item && !disposed; item = nextItem()) {
        try {
          await runTurn(item);
        } catch (err) {
          console.error('[orchestrator] turn crashed', err);    // runTurn handles its own errors; this is the last guard
        }
      }
    } finally {
      draining = false;
      settleIdle();
    }
  }

  // ── Events ──────────────────────────────────────────────

  function say(taskId: string, text: string, bubble: string, priority: 'chip' | 'ack'): void {
    bus.emit({ type: 'agent.say', agentId: 'chipmunk', taskId, text, bubble, priority });
  }

  function status(taskId: string, s: 'listening' | 'thinking' | 'idle' | 'error'): void {
    bus.emit({ type: 'agent.status', agentId: 'chipmunk', taskId, status: s });
  }

  function reportUserMood(turn: Turn, m: UserMood, intensity: number, reason: string): void {
    turn.moodReported = true;
    bus.emit({ type: 'user.mood', agentId: 'chipmunk', taskId: turn.taskId, mood: m, intensity, reason });
    mood.onUserMood(m, intensity, reason, turn.taskId);
  }

  // ── One turn ────────────────────────────────────────────

  async function runTurn(item: InboxItem): Promise<void> {
    const turn: Turn = {
      kind: item.kind,
      taskId: item.kind === 'result' ? item.taskId : newId(),
      moodReported: false, acked: false, actionAttempted: false, delegationSucceeded: false, recalled: new Set(),
    };

    let busy = false;
    // Everything in a turn sits inside this try, so any failure still ends in the foggy line + idle.
    try {
      if (item.kind === 'user') {
        bus.emit({ type: 'user.message', agentId: 'chipmunk', taskId: turn.taskId, text: item.text, source: item.source });
        rememberRequest(turn.taskId, item.text);
        if (isStop(item.text)) {
          const line = cancelForStop(item.text);                 // cancel first, so nothing finishes during the wake
          // Any user input wakes Chip (§4.2), stop commands included; he speaks once awake.
          presence.touch('chipmunk');
          if (presence.get('chipmunk') === 'sleeping') await presence.wake('chipmunk', 'user');
          say(turn.taskId, line.text, line.bubble, 'chip');
          return;                                                // finally → idle
        }
        answerNudge(item.text);
      } else if (item.kind === 'nudge') {
        item.record.asked = true;
      }

      presence.touch('chipmunk');
      if (presence.get('chipmunk') === 'sleeping') await presence.wake('chipmunk', item.kind === 'user' ? 'user' : 'job');
      presence.setBusy('chipmunk', true);
      busy = true;

      if (item.kind === 'user') status(turn.taskId, 'listening');
      status(turn.taskId, 'thinking');

      const content = buildContent(item);
      const memory = item.kind === 'user' ? 'Auto' : 'Readonly';
      let text = await converse(turn, content, memory);
      if (item.kind === 'user') recoverPseudoMood(text, turn);
      if (item.kind === 'user' && !turn.delegationSucceeded && !turn.actionAttempted) {
        const agent = requiredSpecialist(item.text);
        if (agent) {
          if (installedSpecialists().includes(agent)) {
            EXECUTORS.delegate({ agent, task: item.text, title: item.text.slice(0, 80) }, turn);
            turn.actionAttempted = true;
            text = '(silent)';
          } else {
            text = `[bubble: Unavailable]\n${nameOf(agent)} isn't available right now.`;
          }
        }
      }
      // A silent response is only valid after delegation. Retry once only when no action
      // was attempted, so a recovery cannot repeat an already executed side effect.
      const unanswered = (): boolean => parseChipOutput(text).silent || !text.trim();
      if (item.kind === 'user' && !turn.actionAttempted && (unanswered() || PROMISE_ONLY.test(text))) {
        // Mood is only dropped from the corrective turn when it was already reported (a model that
        // repeats the mood tool instead of acting failed C3). If it was never reported, ask for it:
        // a skipped mood read means an angry user would get no reaction from the biome.
        const moodNote = turn.moodReported
          ? 'Mood reporting is already handled; do not repeat it.'
          : 'You have not reported the user\'s mood yet: call report_user_mood first, and in the SAME response also call the tool the request needs or answer it.';
        text = await converse(turn, `${content}\n[runtime_feedback]\nYou returned no answer without attempting an action. The user request is still pending. ${moodNote} Call the appropriate tool now, or answer with the one clarification needed. Do not merely promise to act.`, 'Readonly', true);
        recoverPseudoMood(text, turn);
      }
      // (silent) is only valid after a successful delegation; anything else must not leave the user hearing nothing.
      if (item.kind === 'user' && !turn.delegationSucceeded && unanswered()) {
        text = "[bubble: Try again]\nI couldn't finish that request. Please try again.";
      }
      if (item.kind === 'result' && !turn.delegationSucceeded && unanswered()) {
        text = `[bubble: Results ready]\n${item.finished.map(({ job, result }) =>
          `${nameOf(job.agent)}: ${result.say || result.summary}`).join('\n')}`;
      }

      // A delegated job has not returned yet. Never speak a speculative finding from this turn.
      if (item.kind === 'user' && turn.delegationSucceeded) text = '(silent)';

      if (item.kind === 'user' && !turn.moodReported) moodFallback(turn, item.voiceCues);

      const out = parseChipOutput(text);
      if (!out.silent) say(turn.taskId, out.speech, out.bubble, 'chip');
    } catch (err) {
      if (err instanceof LlmFailure) {
        foggyMood(turn.taskId);
        status(turn.taskId, 'error');                            // the renderer plays Dizzy
      } else {
        console.error('[orchestrator] turn failed', err);
      }
      say(turn.taskId, FOGGY_LINE, 'Foggy 😵', 'chip');
    } finally {
      if (busy) presence.setBusy('chipmunk', false);
      status(turn.taskId, 'idle');
    }
  }

  function recoverPseudoMood(text: string, turn: Turn): void {
    if (turn.moodReported) return;
    const args = pseudoMoodArgs(text);
    if (!args) return;
    try { EXECUTORS.report_user_mood!(args, turn); }
    catch { /* Invalid textual tool arguments use the existing mood fallback. */ }
  }

  function foggyMood(taskId: string): void {
    const sad = bus.emit({ type: 'agent.mood', agentId: 'chipmunk', taskId, mood: 'sad', intensity: 0.6, cause: 'user' });
    const timer = clock.setTimeout(() => {
      foggyTimers.delete(timer);
      if (disposed || lastChipMoodId !== sad.id) return;
      bus.emit({ type: 'agent.mood', agentId: 'chipmunk', taskId, mood: 'neutral', intensity: 0, cause: 'user' });
    }, settings().timers.moodDecaySec * 1000);
    foggyTimers.add(timer);
  }

  function rememberRequest(taskId: string, text: string): void {
    requests.set(taskId, text);
    if (requests.size > REQUESTS_MAX) requests.delete(requests.keys().next().value!);
  }

  /** §9 step 1: ≤ 4 words starting with stop / cancel / never mind / nvm. */
  function isStop(text: string): boolean {
    const trimmed = text.trim();
    // "Stop asking about that" answers a nudge (§14.3); it isn't a job stop.
    return STOP_RE.test(trimmed) && trimmed.split(/\s+/).length <= STOP_MAX_WORDS && !STOP_ASKING_RE.test(trimmed);
  }

  /** Cancels the named animals' jobs (or all). Returns what Chip says about it. No LLM call. */
  function cancelForStop(text: string): { text: string; bubble: string } {
    const trimmed = text.trim();
    const m = STOP_RE.exec(trimmed)!;

    const agents: SpecialistId[] = [];
    for (const word of trimmed.slice(m[0].length).split(/\s+/)) {
      const id = specialistFromWord(word.replace(/[^\p{L}\p{N}]/gu, ''));
      if (id && !agents.includes(id)) agents.push(id);
    }

    if (agents.length === 0) {
      jobs.cancel({ all: true });
      return { text: 'Stopping!', bubble: 'Stopping' };
    }
    for (const agent of agents) jobs.cancel({ agent });
    return { text: `Stopped ${agents.map(nameOf).join(' and ')}!`, bubble: 'Stopped' };
  }

  /** §9 step 2 + §14.3: the first user message within ANSWER_WINDOW_MS of a nudge Chip asked answers it. */
  function answerNudge(text: string): void {
    if (!lastNudge || !lastNudge.asked) return;
    const batch = lastNudge;
    lastNudge = undefined;
    if (clock.now() - batch.firedAt >= ANSWER_WINDOW_MS) return;

    const trimmed = text.trim();
    for (const id of batch.ids) {
      if (SNOOZE_RE.test(trimmed)) nudges.snooze(id, SNOOZE_MINUTES);
      else if (STOP_ASKING_RE.test(trimmed)) nudges.cancel(id);
      else nudges.markAnswered(id);
    }
  }

  function contextState(): ChipContextState {
    const s = settings();
    const p: ChipContextState['presence'] = {};
    for (const id of AGENT_IDS) p[id] = presence.get(id);
    return {
      now: clock.now(), timeZone, userMoodBefore: mood.getUserMood(), jobs: jobs.list(),
      presence: p, installed: s.installed, recentResults: [...recentResults],
    };
  }

  function buildContent(item: InboxItem): string {
    const state = contextState();
    switch (item.kind) {
      case 'user':
        return buildUserTurn(state, item.text, item.voiceCues);
      case 'result': {
        const items: ResultItem[] = item.finished.map(({ job, result }) => ({
          agent: job.agent, title: job.title, ok: result.ok, summary: result.summary,
          originalRequest: requests.get(item.taskId) ?? '',
          ...(job.nextStep !== undefined ? { nextStep: job.nextStep } : {}),
        }));
        return buildResultTurn(state, items);
      }
      case 'nudge':
        return buildNudgeTurn(state, item.batch.map((n) => ({ kind: n.kind, about: n.about, question: n.question })));
    }
  }

  function installedSpecialists(): SpecialistId[] {
    const installed = settings().installed;
    return SPECIALIST_IDS.filter((id) => installed[id]);
  }

  // ── Backboard + tool loop ───────────────────────────────

  async function guard(call: () => Promise<LlmResponse>): Promise<LlmResponse> {
    let res: LlmResponse;
    try {
      res = await call();
    } catch (err) {
      throw new LlmFailure(err instanceof Error ? err.message : String(err));
    }
    if (res.status === 'FAILED' || res.status === 'CANCELLED') throw new LlmFailure(`Backboard run ${res.status}`);
    return res;
  }

  function noteResponse(turn: Turn, res: LlmResponse): void {
    const memories = res.retrieved_memories;
    if (!memories || memories.length === 0) return;
    const key = JSON.stringify([...memories].sort());
    if (turn.recalled.has(key)) return;
    turn.recalled.add(key);
    bus.emit({ type: 'agent.recall', agentId: 'chipmunk', taskId: turn.taskId, memories: [...memories] });
  }

  /** Returns Chip's final text (§11 format). */
  async function converse(turn: Turn, content: string, memory: 'Auto' | 'Readonly', recovery = false): Promise<string> {
    let res = await guard(() => llm.send({
      assistantId: chipAssistantId,
      ...(chipThreadId !== undefined ? { threadId: chipThreadId } : {}),
      content,
      systemPrompt: chipSystemPrompt(),
      tools: chipTools(installedSpecialists()).filter((tool) => !(recovery && turn.moodReported) || tool.function.name !== 'report_user_mood'),
      model: settings().models.chipmunk,
      memory,
      timeoutMs: llmTimeoutMs,
    }));
    if (chipThreadId === undefined && res.thread_id) chipThreadId = res.thread_id;
    noteResponse(turn, res);

    for (let rounds = 0; res.status === 'REQUIRES_ACTION'; rounds++) {
      const calls = res.tool_calls ?? [];
      if (rounds >= MAX_TOOL_ROUNDS || calls.length === 0) {
        return res.content?.trim() ? res.content : `[bubble: Partway]\n${PARTWAY_LINE}`;
      }
      const outputs = await Promise.all(calls.map(async (call) => ({ tool_call_id: call.id, output: await runTool(call, turn) })));
      const threadId = res.thread_id;
      // Give tool continuations the same deadline and the latest Settings model.
      // A request that never settles would otherwise hold Chip's only loop forever.
      res = await guard(() => llm.submitToolOutputs(threadId, outputs, AbortSignal.timeout(llmTimeoutMs), settings().models.chipmunk));
      noteResponse(turn, res);
    }
    return res.content ?? '';
  }

  async function runTool(call: LlmToolCall, turn: Turn): Promise<string> {
    let result: unknown;
    try {
      // The tool name comes from the model: own keys only, so 'constructor' / 'toString' count as unknown.
      const name = call.function.name;
      if (name !== 'report_user_mood') turn.actionAttempted = true;
      if (!Object.hasOwn(EXECUTORS, name)) throw new Error(`unknown tool: ${name}`);
      result = await EXECUTORS[name]!(parseArgs(call.function.arguments), turn);
    } catch (err) {
      result = { error: err instanceof Error ? err.message : String(err) };
    }
    return (JSON.stringify(result) ?? 'null').slice(0, TOOL_OUTPUT_MAX_CHARS);
  }

  // ── Tool executors (§10) ────────────────────────────────

  const EXECUTORS: Record<string, Executor> = {
    report_user_mood(args, turn) {
      if (turn.kind !== 'user') return { ok: true };                 // only user turns report mood (§10.1)
      const m = args.mood;
      if (typeof m !== 'string' || !(USER_MOODS as string[]).includes(m)) throw new Error('bad mood');
      const raw = typeof args.intensity === 'number' ? args.intensity : Number(args.intensity);
      if (!Number.isFinite(raw)) throw new Error('bad intensity');
      const reason = typeof args.reason === 'string' ? args.reason : '';
      reportUserMood(turn, m as UserMood, Math.min(1, Math.max(0, raw)), reason);
      return { ok: true };
    },

    delegate(args, turn) {
      const agent = args.agent;
      if (typeof agent !== 'string' || !(installedSpecialists() as string[]).includes(agent)) {
        throw new Error(`agent not installed: ${String(agent)}`);
      }
      const task = nonEmpty(args.task);
      const title = nonEmpty(args.title);
      if (!task) throw new Error('task is required');
      if (!title) throw new Error('title is required');
      const nextStep = nonEmpty(args.next_step);
      const planStep = Number(args.plan_step);

      const res = jobs.submit({
        agent: agent as SpecialistId, task, title, requestedBy: 'chipmunk', kind: 'normal', parentTaskId: turn.taskId,
        ...(nextStep ? { nextStep } : {}),
        ...(args.plan_step !== undefined && Number.isInteger(planStep) ? { planStep } : {}),
      });
      if (res.status !== 'not_installed') turn.delegationSucceeded = true;

      if (turn.kind === 'user' && !turn.acked) {
        turn.acked = true;
        const ack = pickAck(agent as SpecialistId, res.status, mood.getUserMood());
        if (ack) say(turn.taskId, ack.text, ack.bubble, 'ack');
      }
      return { status: res.status, jobId: res.jobId, position: res.position };
    },

    cancel_jobs(args) {
      const agent = args.agent;
      if (agent === undefined || agent === null || agent === '') return { cancelled: jobs.cancel({ all: true }) };
      if (typeof agent !== 'string' || !(SPECIALIST_IDS as string[]).includes(agent)) throw new Error(`unknown agent: ${String(agent)}`);
      return { cancelled: jobs.cancel({ agent: agent as SpecialistId }) };
    },

    schedule_followup(args) {
      const question = nonEmpty(args.question);
      const about = nonEmpty(args.about);
      if (!question) throw new Error('question is required');
      if (!about) throw new Error('about is required');
      const askAt = typeof args.ask_at === 'string' ? new Date(args.ask_at) : new Date(NaN);
      if (Number.isNaN(askAt.getTime()) || askAt.getTime() <= clock.now()) throw new Error('bad ask_at');
      return { id: nudges.schedule({ kind: 'custom', source: 'chip', question, about, askAt }) };
    },

    async biome_history(args) {
      const kind = args.kind;
      if (typeof kind !== 'string' || !(HISTORY_KINDS as string[]).includes(kind)) throw new Error('bad kind');
      const since = typeof args.since_hours === 'number' && Number.isFinite(args.since_hours) && args.since_hours > 0
        ? args.since_hours : DEFAULT_SINCE_HOURS;
      let agent: AgentId | undefined;
      if (typeof args.agent === 'string' && args.agent.trim()) {
        agent = (AGENT_IDS as string[]).includes(args.agent) ? (args.agent as AgentId) : specialistFromWord(args.agent);
        if (!agent) throw new Error(`unknown agent: ${args.agent}`);
      }
      return { rows: await history.query(kind as HistoryKind, since, agent) };
    },
  };

  // ── Mood fallback (§9 step 7) ───────────────────────────

  function moodFallback(turn: Turn, cues: string[]): void {
    const norm = cues.map((c) => c.trim().toLowerCase().replace(/^\(|\)$/g, '').trim());
    if (norm.includes('sighs')) reportUserMood(turn, 'stressed', 0.5, 'voice cue (sighs)');
    else if (norm.includes('laughter') || norm.includes('laughs')) reportUserMood(turn, 'happy', 0.5, 'voice cue (laughter)');
    else reportUserMood(turn, 'calm', 0.3, 'no mood reported');
  }

  // ── Public API ──────────────────────────────────────────

  return {
    submitUserMessage(text, o = {}) {
      if (disposed || !text.trim()) return;
      userQ.push({ kind: 'user', text, source: o.source ?? 'text', voiceCues: o.voiceCues ?? [] });
      kick();
    },

    whenIdle() {
      if (!draining && queuesEmpty()) return Promise.resolve();
      return new Promise<void>((resolve) => { idleWaiters.push(resolve); });
    },

    dispose() {
      if (disposed) return;
      disposed = true;                                           // onFinished / onDue have no unsubscribe; this flag gates them
      for (const { timer } of pendingResults.values()) clock.clearTimeout(timer);
      pendingResults.clear();
      for (const timer of foggyTimers) clock.clearTimeout(timer);
      foggyTimers.clear();
      unsubscribe();
      userQ.length = 0;
      resultQ.length = 0;
      nudgeQ.length = 0;
      settleIdle();
    },
  };
}

function parseArgs(raw: string): ToolArgs {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw || '{}');
  } catch {
    throw new Error('bad JSON arguments');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error('arguments must be a JSON object');
  return parsed as ToolArgs;
}

function nonEmpty(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}
