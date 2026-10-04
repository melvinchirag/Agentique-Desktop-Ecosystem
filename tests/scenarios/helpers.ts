import { afterEach } from 'vitest';
import type { AgentId } from '../../src/shared/agents';
import type { BiomeEvent } from '../../src/shared/events';
import type { AdeSettings } from '../../src/shared/ipc';
import { FakeClock } from '../../src/main/runtime/clock';
import type { CalendarSource, LlmClient, LlmResponse, SpecialistId } from '../../src/main/runtime/types';
import { buildOfflineChip, type OfflineChip } from '../../src/main/testing/offlineChip';
import {
  completed, FakeLlm, type FakeLlmCall, type FakeLlmStep, FakeSpecialists, requiresAction, toolCall,
} from '../../src/main/testing';

export const SEC = 1000;
export const MIN = 60 * SEC;
export const HOUR = 60 * MIN;

export type Ev<T extends BiomeEvent['type']> = Extract<BiomeEvent, { type: T }>;

// ── Script builders (what the fake Backboard answers) ─────

export const mood = (m = 'calm', intensity = 0.4, reason = 'plain words') => toolCall('report_user_mood', { mood: m, intensity, reason });
export const delegate = (agent: SpecialistId, title: string, extra: Record<string, unknown> = {}) =>
  toolCall('delegate', { agent, task: `Please do: ${title}`, title, ...extra });
/** A REQUIRES_ACTION step with these tool calls. */
export const tools = (...calls: ReturnType<typeof toolCall>[]) => requiresAction(calls);
/** A final answer in Chip's output format (§11): bubble line + speech. */
export const say = (bubble: string, speech: string) => completed(`[bubble: ${bubble}]\n${speech}`);
export const silent = () => completed('(silent)');

/** The tool output Chip's runtime handed back for call `i` of a toolOutputs step. */
export function outputOf(call: FakeLlmCall | undefined, i = 0): Record<string, unknown> {
  if (!call || call.kind !== 'toolOutputs') throw new Error('not a toolOutputs call');
  return JSON.parse(call.outputs[i]!.output) as Record<string, unknown>;
}

/** A Backboard stand-in that answers by looking at the request, for scenarios where timing decides the order of turns. */
export class RoutedLlm implements LlmClient {
  readonly calls: FakeLlmCall[] = [];
  constructor(private readonly route: (call: FakeLlmCall) => LlmResponse) {}
  async send(params: Parameters<LlmClient['send']>[0]): Promise<LlmResponse> {
    const call: FakeLlmCall = { kind: 'send', params };
    this.calls.push(call);
    return this.route(call);
  }
  async submitToolOutputs(threadId: string, outputs: { tool_call_id: string; output: string }[]): Promise<LlmResponse> {
    const call: FakeLlmCall = { kind: 'toolOutputs', threadId, outputs };
    this.calls.push(call);
    return this.route(call);
  }
}

// ── The scenario rig ──────────────────────────────────────

export interface RigOptions {
  script?: FakeLlmStep[];
  llm?: LlmClient;
  delayMs?: number | Partial<Record<SpecialistId, number>>;
  settings?: AdeSettings;
  startNudges?: boolean;                          // default false: scenarios that don't test nudges stay free of rule nudges
  start?: Date;                                   // default local noon, Sun Oct 4 2026
  calendar?: CalendarSource;
  plannerLlm?: LlmClient;
}

const rigs: OfflineChip[] = [];
afterEach(() => {
  for (const r of rigs.splice(0)) r.dispose();
});

export function makeRig(o: RigOptions = {}) {
  const clock = new FakeClock(o.start ?? new Date(2026, 9, 4, 12, 0));
  const llm = o.llm ?? new FakeLlm(o.script ?? []);
  const specialists = new FakeSpecialists({ clock, delayMs: o.delayMs ?? 3 * SEC });
  const chip = buildOfflineChip({
    clock, llm, specialists, startNudges: o.startNudges ?? false,
    ...(o.settings ? { settings: o.settings } : {}),
    ...(o.calendar ? { calendar: o.calendar } : {}),
    ...(o.plannerLlm ? { plannerLlm: o.plannerLlm } : {}),
  });
  rigs.push(chip);

  const startedAt = clock.now();
  const events = (): BiomeEvent[] => chip.events();
  const ofType = <T extends BiomeEvent['type']>(t: T): Ev<T>[] => events().filter((e): e is Ev<T> => e.type === t);
  const chipSays = (priority?: Ev<'agent.say'>['priority']) =>
    ofType('agent.say').filter((e) => e.agentId === 'chipmunk' && (!priority || e.priority === priority));
  const reports = (agent?: AgentId) => ofType('agent.say').filter((e) => e.priority === 'report' && (!agent || e.agentId === agent));
  const jobUpdates = (to?: SpecialistId) => ofType('job.update').filter((e) => !to || e.to === to);
  const handoffs = () => ofType('agent.handoff');
  const presenceEvents = (id: AgentId) => ofType('agent.presence').filter((e) => e.agentId === id);
  const moodsOf = (id: AgentId) => ofType('agent.mood').filter((e) => e.agentId === id);
  const llmCalls = (): FakeLlmCall[] => (llm as FakeLlm | RoutedLlm).calls;
  const sends = () => llmCalls().flatMap((c) => (c.kind === 'send' ? [c.params] : []));
  const toolOutputs = () => llmCalls().flatMap((c) => (c.kind === 'toolOutputs' ? [c] : []));
  /** Seconds since the rig started, as the events saw it. */
  const at = (e: BiomeEvent): number => (e.ts - startedAt) / SEC;
  /** Index of the first event matching `pred`, or -1. */
  const indexOf = (pred: (e: BiomeEvent) => boolean): number => events().findIndex(pred);

  const user = async (text: string, opts?: { source?: 'text' | 'voice'; voiceCues?: string[] }): Promise<void> => {
    chip.orchestrator.submitUserMessage(text, opts);
    await chip.orchestrator.whenIdle();
  };
  /** Moves the fake clock, then waits for any Chip turn that started to finish. */
  const advance = async (ms: number): Promise<void> => {
    await clock.advanceAsync(ms);
    await chip.orchestrator.whenIdle();
  };

  return {
    chip, clock, llm, specialists, startedAt,
    events, ofType, chipSays, reports, jobUpdates, handoffs, presenceEvents, moodsOf, sends, llmCalls, toolOutputs, at, indexOf,
    user, advance,
  };
}
