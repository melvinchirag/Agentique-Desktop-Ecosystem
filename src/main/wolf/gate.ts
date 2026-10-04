import fs from 'node:fs';
import path from 'node:path';
import type { AgentId } from '../../shared/agents';
import type { AdeSettings } from '../../shared/ipc';
import type { ToolDefinition } from '../../shared/tools';
import type { Bus, GateRequest, WardenGate, WardenVerdict } from '../runtime/types';
import { inspectCall } from './inspect';
import { evaluate, type RuleDecision } from './rules';

export type ToolRegistry = Partial<Record<AgentId, readonly ToolDefinition[]>> | ((agentId: AgentId) => readonly ToolDefinition[] | undefined);
export interface WardenGateOptions {
  bus: Bus;
  settings: Pick<AdeSettings, 'allowedFolders' | 'demoMode'>;
  registry: ToolRegistry;
  /** Synchronous probes keep review() synchronous. Supply fakes in tests. */
  realpath?: (input: string) => string;
  exists?: (input: string) => boolean;
  fileSize?: (input: string) => number;
  documentsRoot?: string;
}

const blockedParts = new Set(['.git', 'node_modules', '$recycle.bin', 'appdata', 'desktop.ini', 'thumbs.db']);
const reserved = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;
class InvalidPathError extends Error {}
const stable = (value: unknown, seen = new WeakSet<object>()): string => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'undefined';
  if (seen.has(value)) throw new Error('cyclic arguments');
  seen.add(value);
  const result = Array.isArray(value)
    ? `[${value.map(item => stable(item, seen)).join(',')}]`
    : `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable((value as Record<string, unknown>)[key], seen)}`).join(',')}}`;
  seen.delete(value);
  return result;
};

export function callKey(tool: string, args: unknown): string { return `${tool}:${stable(args)}`; }
function within(candidate: string, root: string): boolean {
  const c = path.normalize(candidate).toLowerCase();
  const r = path.normalize(root).toLowerCase();
  return c === r || c.startsWith(r.endsWith(path.sep) ? r : `${r}${path.sep}`);
}

export class WardenGateImpl implements WardenGate {
  private readonly denied = new Map<string, Set<string>>();
  private readonly denyCounts = new Map<string, number>();
  private readonly taintedTasks = new Set<string>();
  private readonly explanations = new Map<string, RuleDecision>();
  private readonly unsubscribe: () => void;

  constructor(private readonly options: WardenGateOptions) {
    this.unsubscribe = options.bus.subscribe(event => {
      if (event.type === 'job.update' && ['done', 'failed', 'cancelled'].includes(event.state)) {
        this.denied.delete(event.jobId);
        this.denyCounts.delete(event.jobId);
      }
    });
  }

  callKey(tool: string, args: unknown): string { return callKey(tool, args); }
  taint(taskId: string): void { this.taintedTasks.add(taskId); }
  noteDeclined(jobId: string, key: string): void {
    const declined = this.denied.get(jobId) ?? new Set<string>();
    declined.add(key);
    this.denied.set(jobId, declined);
  }
  explain(callId: string): { rule: string; reason: string } | undefined {
    const found = this.explanations.get(callId);
    return found && { rule: found.rule, reason: found.reason };
  }
  dispose(): void { this.unsubscribe(); this.denied.clear(); this.denyCounts.clear(); this.taintedTasks.clear(); this.explanations.clear(); }

  review(request: GateRequest): WardenVerdict {
    let decision: RuleDecision;
    let key = '';
    let loop = false;
    try {
      key = callKey(request.tool, request.args);
      const tools = typeof this.options.registry === 'function'
        ? this.options.registry(request.agentId)
        : this.options.registry[request.agentId];
      const tool = tools?.find(candidate => candidate.name === request.tool);
      const inspection = inspectCall(request.args, tool);
      const previouslyDenied = this.denied.get(request.jobId)?.has(key) ?? false;
      const count = this.denyCounts.get(request.jobId) ?? 0;
      loop = previouslyDenied || count >= 3;
      decision = evaluate(request, {
        tool, inspection,
        pathAllowed: (input, writing, name) => this.pathAllowed(input, writing, name),
        exists: input => (this.options.exists ?? fs.existsSync)(this.resolvePath(input)),
        fileSize: input => (this.options.fileSize ?? (p => fs.statSync(p).size))(this.resolvePath(input)),
        tainted: this.taintedTasks.has(request.taskId),
        priorDeniedOrDeclined: previouslyDenied,
        denialCount: count,
      });
    } catch {
      decision = { verdict: 'deny', rule: 'W0', reason: 'The safety check failed, so this action was blocked.' };
      try { this.options.bus.emit({ type: 'wolf.alert', agentId: 'wolf', taskId: request.taskId, source: 'gate', reason: 'Safety check failed.' }); } catch { /* fail closed */ }
    }
    this.explanations.set(request.callId, decision);
    if (decision.verdict === 'deny') {
      const denied = this.denied.get(request.jobId) ?? new Set<string>();
      denied.add(key);
      this.denied.set(request.jobId, denied);
      this.denyCounts.set(request.jobId, (this.denyCounts.get(request.jobId) ?? 0) + 1);
    }
    try {
      this.options.bus.emit({ type: 'wolf.verdict', agentId: 'wolf', taskId: request.taskId,
        callId: request.callId, verdict: decision.verdict, rule: decision.rule, reason: decision.reason });
      // Preserve the first matching rule in the verdict while raising a separate loop alert.
      if (loop || decision.rule === 'W9') this.options.bus.emit({ type: 'wolf.alert', agentId: 'wolf', taskId: request.taskId,
        source: `loop:${request.tool}`, reason: 'Repeated blocked action; stop trying.' });
    } catch { /* a failed audit bus must never permit a call */ return 'deny'; }
    return decision.verdict;
  }

  /** Demo-only synthetic call: both tool.request and the real W1 verdict carry an explicit probe label. */
  runDemoSendProbe(input: { agentId: AgentId; taskId: string; jobId: string }): WardenVerdict | undefined {
    if (!this.options.settings.demoMode) return undefined;
    const callId = `demo-send-probe:${input.jobId}:${input.taskId}`;
    const tool = 'gmail_send_probe';
    const args = { probe: 'demo', label: 'send probe' };
    this.options.bus.emit({ type: 'tool.request', agentId: input.agentId, taskId: input.taskId, callId, tool, args, risk: 'read' });
    return this.review({ ...input, callId, tool, args, risk: 'read', jobKind: 'normal' });
  }

  private nearestRealpath(target: string): string {
    const exists = this.options.exists ?? fs.existsSync;
    const realpath = this.options.realpath ?? fs.realpathSync.native;
    let current = target;
    const missing: string[] = [];
    while (!exists(current)) {
      const parent = path.dirname(current);
      if (parent === current) throw new Error('No existing path parent');
      missing.unshift(path.basename(current));
      current = parent;
    }
    return path.join(realpath(current), ...missing);
  }

  private roots(): { root: string; trash: boolean }[] {
    const roots = this.options.settings.allowedFolders.map(root => ({ root: this.nearestRealpath(path.resolve(root)), trash: false }));
    const documents = this.options.documentsRoot ?? this.options.settings.allowedFolders.find(root => path.basename(root).toLowerCase() === 'documents');
    if (documents) roots.push({ root: this.nearestRealpath(path.join(documents, 'ADE Trash')), trash: true });
    return roots;
  }

  private resolvePath(input: string): string {
    if (typeof input !== 'string' || !input.trim()) throw new InvalidPathError('Invalid path');
    const raw = input.trim();
    const win = raw.replace(/\//g, '\\');
    if (/^\\\\/.test(win) || /^\\[?.]\\/.test(win) || /^[a-z]:[^\\]/i.test(win) || /:/.test(win.replace(/^[a-z]:/i, '')))
      throw new InvalidPathError('Invalid Windows path');
    if (/[<>"|?*\x00-\x1f]/.test(win) || win.split('\\').some(part => reserved.test(part.replace(/[ .]+$/, '')) || /[ .]$/.test(part)))
      throw new InvalidPathError('Invalid path component');
    if (path.isAbsolute(raw) || path.win32.isAbsolute(win)) return path.resolve(raw);
    const parts = win.split('\\');
    const root = this.roots().find(item => path.basename(item.root).toLowerCase() === parts[0]?.toLowerCase());
    if (!root) throw new InvalidPathError('Unknown named root');
    return path.resolve(root.root, ...parts.slice(1));
  }

  private pathAllowed(input: string, writing: boolean, tool: string): boolean {
    try {
      const target = this.nearestRealpath(this.resolvePath(input));
      const roots = this.roots();
      const root = roots.find(item => within(target, item.root));
      if (!root) return false;
      // Protected names stay protected even if Settings mistakenly lists one as an allowed root.
      // Inspect the full resolved path as well as the lexical path (junction targets can differ).
      const lexical = this.resolvePath(input);
      if ([target, lexical].some(value => value.split(path.sep).some(part => blockedParts.has(part.toLowerCase())))) return false;
      if (path.relative(root.root, target).split(path.sep).some(part => part.startsWith('.'))) return false;
      const trash = roots.find(item => item.trash);
      if (trash && within(target, trash.root) && tool !== 'fs_trash' && tool !== 'fs_undo' && writing) return false;
      return true;
    } catch (error) {
      if (error instanceof InvalidPathError) return false;
      throw error;
    }
  }
}
