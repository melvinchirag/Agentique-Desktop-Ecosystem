import path from 'node:path';
import type { GateRequest, WardenVerdict } from '../runtime/types';
import type { Risk, ToolDefinition, ToolInspection } from '../../shared/tools';

export type RuleId = 'W0' | 'W1' | 'W2' | 'W3' | 'W4' | 'W5' | 'W6' | 'W7' | 'W8' | 'W9' | 'W10' | 'W11' | 'W12' | 'W13' | 'W14' | 'W16';
export interface RuleDecision { verdict: WardenVerdict; rule: RuleId; reason: string }
export interface RuleContext {
  tool?: ToolDefinition;
  inspection: ToolInspection;
  pathAllowed: (input: string, writing: boolean, tool: string) => boolean;
  exists?: (input: string) => boolean;
  fileSize?: (input: string) => number;
  tainted?: boolean;
  priorDeniedOrDeclined?: boolean;
  denialCount?: number;
}

const rank: Record<Risk, number> = { read: 0, draft: 1, write: 2, destructive: 3, external: 4 };
const forbiddenSegments = new Set(['send', 'forward', 'post', 'publish', 'share', 'purchase', 'pay', 'transfer', 'invite']);
const openExtensions = new Set(['.exe', '.msi', '.bat', '.cmd', '.ps1', '.vbs', '.js', '.jse', '.wsf', '.lnk', '.scr', '.com', '.reg', '.hta', '.jar']);
const urlExtensions = new Set(['.exe', '.msi', '.zip', '.7z', '.rar', '.dmg', '.apk', '.bat', '.ps1']);
const MAX_ATTACHMENTS_BYTES = 25 * 1024 * 1024;

export function hasForbiddenSegment(name: string): boolean {
  return name.toLowerCase().split('_').some(segment => forbiddenSegments.has(segment));
}

export function isExecutablePath(input: string): boolean {
  return openExtensions.has(path.extname(input.replace(/\\/g, '/')).toLowerCase());
}

export function effectiveRisk(request: GateRequest, tool: ToolDefinition): Risk {
  const dynamic = tool.riskFor?.(request.args);
  for (const value of [request.risk, tool.risk, dynamic]) {
    if (value !== undefined && !Object.hasOwn(rank, value)) throw new Error('Invalid tool risk');
  }
  return [request.risk, tool.risk, dynamic].filter((value): value is Risk => !!value)
    .reduce((max, value) => rank[value] > rank[max] ? value : max, 'read');
}

function decision(verdict: WardenVerdict, rule: RuleId, reason: string): RuleDecision { return { verdict, rule, reason }; }

function urlAllowed(raw: string, agentId: string): boolean {
  try {
    const url = new URL(raw);
    if (url.protocol === 'spotify:' && agentId === 'nightingale') return true;
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
    return !urlExtensions.has(path.posix.extname(url.pathname).toLowerCase());
  } catch { return false; }
}

/** Deterministic first-match rule table. W0 is the caller's exception wrapper. */
export function evaluate(request: GateRequest, ctx: RuleContext): RuleDecision {
  const { tool, inspection } = ctx;
  // W1 precedes registry membership so a hallucinated send tool gets the clear no-send verdict.
  if (request.risk === 'external' || hasForbiddenSegment(request.tool) || tool?.risk === 'external')
    return decision('deny', 'W1', 'ADE never sends, posts, shares, or buys for you.');
  if (!tool || (request.jobKind === 'help' && request.tool === 'ask_teammate'))
    return decision('deny', 'W10', 'This tool is unavailable to this agent.');
  let risk = effectiveRisk(request, tool);
  if (risk === 'external') return decision('deny', 'W1', 'ADE never sends, posts, shares, or buys for you.');
  if (request.jobKind === 'help' && risk === 'destructive')
    return decision('deny', 'W14', 'Helpers cannot remove files or other content.');
  if (risk === 'destructive' && request.tool !== 'fs_trash')
    return decision('deny', 'W4', 'This destructive action is unavailable.');

  const writes = new Set(inspection.writesPaths ?? []);
  for (const input of inspection.paths ?? []) {
    if (!ctx.pathAllowed(input, writes.has(input) || risk !== 'read', request.tool))
      return decision('deny', 'W5', 'That path is outside the allowed folders or is protected.');
  }
  if (risk === 'draft' && (inspection.writesPaths ?? []).some(input => ctx.exists?.(input))) risk = 'write';
  if (request.tool.endsWith('_open') && (inspection.paths ?? []).some(isExecutablePath))
    return decision('deny', 'W7', 'ADE cannot open programs, scripts, or shortcuts.');
  if ((inspection.urls ?? []).some(raw => !urlAllowed(raw, request.agentId)))
    return decision('deny', 'W12', 'That link cannot be opened safely.');
  const attachments = inspection.attachments ?? [];
  if (attachments.length) {
    let total = 0;
    for (const attachment of attachments) {
      if (isExecutablePath(attachment)) return decision('deny', 'W13', 'That attachment type is blocked.');
      const size = ctx.fileSize?.(attachment);
      if (size === undefined || !Number.isFinite(size) || size < 0) return decision('deny', 'W13', 'Attachment size could not be verified.');
      total += size;
      if (total > MAX_ATTACHMENTS_BYTES) return decision('deny', 'W13', 'Attachments exceed 25 MB.');
    }
  }
  if (ctx.priorDeniedOrDeclined || (ctx.denialCount ?? 0) >= 3)
    return decision('deny', 'W9', 'Stop retrying this action.');
  if (request.tool === 'fs_undo' && !ctx.tainted) return decision('allow', 'W11', 'Undo is allowed.');
  // W6 outranks W16, including for a tainted 37-file undo.
  if ((inspection.count ?? 0) > 25) return decision('ask', 'W6', 'This action touches more than 25 items.');
  if (ctx.tainted && (risk === 'draft' || risk === 'write'))
    return decision('ask', 'W16', 'This task saw suspicious content; review this change.');
  if (inspection.hasAttendees && risk === 'write')
    return decision('ask', 'W8', 'Review this calendar change; no invites will be sent.');
  if (risk === 'destructive') return decision('ask', 'W4', 'Review this move to ADE Trash.');
  if (risk === 'write') return decision('ask', 'W3', 'Review this change.');
  return decision('allow', 'W2', 'This action is allowed.');
}
