import { randomUUID } from 'node:crypto';
import type { AdeSettings } from '../../shared/ipc';
import type {
  Bus, CalendarEvent, CalendarSource, Clock, LlmClient, Nudge, NudgeEngine, NudgeKind, NudgeStore, TimerHandle,
} from './types';

export interface NudgeDeps {
  bus: Bus; clock: Clock; settings: () => AdeSettings;
  store: NudgeStore; calendar: CalendarSource; llm: LlmClient;
  chipAssistantId: string;
  /** True while the user holds Chip, during a Chip turn, or < 20 s after their last message. */
  isUserBusy: () => boolean;
  isDoNotDisturb?: () => boolean;
  newId?: () => string;
}

export const CHECK_EVERY_MS = 30_000;
export const PLANNER_RETRY_MS = 60 * 60_000;
export const ANSWER_WINDOW_MS = 10 * 60_000;

const HOUR_MS = 60 * 60_000;
const DAY_MS = 24 * HOUR_MS;
const EVENING_HOUR = 20;
const WEEKLY_HOUR = 18;
const SUNDAY = 0;
const FAR_FUTURE = new Date(8.64e15);
const noop = (): void => {};

type RuleKind = 'daily' | 'evening' | 'weekly';
const RULE_TEXT: Record<RuleKind, { question: string; about: string }> = {
  daily: { question: 'Morning! Want the rundown for today?', about: 'daily check-in' },
  evening: { question: "Wrap-up time. How'd today go? Anything to move to tomorrow?", about: 'evening wrap-up' },
  weekly: { question: 'Big week ahead. Want a plan?', about: 'weekly plan' },
};

// ── Time helpers (process local time) ─────────────────────

/** 'HH:MM' → minutes after midnight, or null if malformed. */
function parseClock(hhmm: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  return h < 24 && min < 60 ? h * 60 + min : null;
}

/** Quiet range check; the range may wrap midnight (23:00–08:00). Equal bounds or bad input → never quiet. */
export function isQuietTime(at: Date, quietStart: string, quietEnd: string): boolean {
  const start = parseClock(quietStart);
  const end = parseClock(quietEnd);
  if (start === null || end === null || start === end) return false;
  const minutes = at.getHours() * 60 + at.getMinutes();
  return start < end ? minutes >= start && minutes < end : minutes >= start || minutes < end;
}

/** Local wall-clock time on the day `base` + `days`. */
function atLocal(base: Date, days: number, hour: number, minute: number): Date {
  return new Date(base.getFullYear(), base.getMonth(), base.getDate() + days, hour, minute, 0, 0);
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function localDay(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function localIso(d: Date): string {
  const off = -d.getTimezoneOffset();
  const sign = off < 0 ? '-' : '+';
  const abs = Math.abs(off);
  return `${localDay(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

/** Rule nudges carry a per-day key in `eventId` so a restart never schedules the same one twice. */
function ruleKey(kind: RuleKind, askAt: Date): string {
  return `rule:${kind}:${localDay(askAt)}`;
}

function copy(n: Nudge): Nudge {
  return { ...n, askAt: new Date(n.askAt) };
}

function isRuleKind(kind: NudgeKind): kind is RuleKind {
  return kind === 'daily' || kind === 'evening' || kind === 'weekly';
}

// ── Planner prompt ────────────────────────────────────────

export function buildPlannerPrompt(events: CalendarEvent[], now: Date): string {
  const list = events.map((e) => ({ id: e.id, title: e.title, start: e.start.toISOString(), end: e.end.toISOString() }));
  return [
    "You decide when Chip, the user's friendly chipmunk guide, should reach out first about upcoming calendar events.",
    '',
    `Current time: ${localIso(now)} (${now.toISOString()} UTC)`,
    '',
    'Rules:',
    '- Only important events: exams, interviews, deadlines, presentations, games, trips, appointments. Skip routine ones (classes, meetings, lunch, recurring chores).',
    '- kind "after": ask 1-2 hours after the event ends ("How did it go?").',
    '- kind "before": ask the evening before, or a few hours before the event.',
    '- At most one "before" and one "after" per event. Every askAt must be in the future.',
    '- "question" is one short, warm sentence Chip says to the user. "about" is 2-4 words naming the event.',
    '- Use the event "id" exactly as given. Write askAt as ISO 8601 with a timezone offset.',
    '- If no event deserves a nudge, return an empty list.',
    '',
    'Events (JSON):',
    JSON.stringify(list),
    '',
    'Reply with JSON only, in exactly this shape:',
    '{ "nudges": [ { "eventId": "<event id>", "kind": "before" | "after", "askAt": "<ISO 8601>", "question": "<what Chip asks>", "about": "<short topic>" } ] }',
  ].join('\n');
}

function parsePlannerContent(content: string | null | undefined): unknown[] {
  if (typeof content !== 'string') throw new Error('planner: empty response');
  const text = content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const parsed: unknown = JSON.parse(text);
  const list = typeof parsed === 'object' && parsed !== null ? (parsed as { nudges?: unknown }).nudges : undefined;
  if (!Array.isArray(list)) throw new Error('planner: missing nudges array');
  return list;
}

// ── Engine ────────────────────────────────────────────────

export function createNudgeEngine(deps: NudgeDeps): NudgeEngine {
  return new Engine(deps);
}

class Engine implements NudgeEngine {
  /** Sync copy of everything this engine scheduled or has seen, so schedule() can return at once. */
  private readonly mirror = new Map<string, Nudge>();
  private readonly callbacks: ((batch: Nudge[]) => void)[] = [];
  private readonly batchTimes: number[] = [];
  private readonly newId: () => string;
  private writes: Promise<void> = Promise.resolve();   // store writes, in order
  private chain: Promise<void> = Promise.resolve();    // check / rule / fireNextNow work, one at a time
  private checkTimer: TimerHandle | undefined;
  private midnightTimer: TimerHandle | undefined;
  private retryTimer: TimerHandle | undefined;
  private started = false;
  private disposed = false;
  private plannerRunning = false;

  constructor(private readonly deps: NudgeDeps) {
    this.newId = deps.newId ?? randomUUID;
  }

  start(): void {
    if (this.started || this.disposed) return;
    this.started = true;
    this.armCheck();
    void this.enqueue(() => this.initRules());
    this.armMidnight();
    void this.runPlanner();
  }

  schedule(n: Omit<Nudge, 'id' | 'state'>): string {
    const nudge: Nudge = { ...n, askAt: new Date(n.askAt), id: this.newId(), state: 'pending' };
    this.mirror.set(nudge.id, nudge);
    this.write(() => this.deps.store.insert(copy(nudge)));
    return nudge.id;
  }

  cancel(id: string): void {
    this.patch(id, { state: 'cancelled' });
  }

  markAnswered(id: string): void {
    this.patch(id, { state: 'answered' });
  }

  snooze(id: string, minutes: number): void {
    this.patch(id, { state: 'snoozed', askAt: new Date(this.deps.clock.now() + minutes * 60_000) });
  }

  fireNextNow(): void {
    void this.enqueue(async () => {
      if (this.disposed) return;
      await this.writes;
      for (const row of await this.deps.store.due(FAR_FUTURE)) {
        if (!this.mirror.has(row.id)) this.mirror.set(row.id, copy(row));
      }
      let next: Nudge | undefined;
      for (const n of this.mirror.values()) {
        if (n.state !== 'pending' && n.state !== 'snoozed') continue;
        if (!next || n.askAt.getTime() < next.askAt.getTime()) next = n;
      }
      if (!next) return;
      await this.fireBatch([next], new Date(this.deps.clock.now()));
      await this.check();
    });
  }

  onDue(cb: (batch: Nudge[]) => void): void {
    this.callbacks.push(cb);
  }

  dispose(): void {
    this.disposed = true;
    const { clock } = this.deps;
    for (const h of [this.checkTimer, this.midnightTimer, this.retryTimer]) {
      if (h !== undefined) clock.clearTimeout(h);
    }
    this.checkTimer = this.midnightTimer = this.retryTimer = undefined;
  }

  // ── plumbing ────────────────────────────────────────────

  private write(op: () => Promise<void>): void {
    this.writes = this.writes.then(op).catch(noop);
  }

  private patch(id: string, p: Partial<Nudge>): void {
    const known = this.mirror.get(id);
    if (known) Object.assign(known, p);
    this.write(() => this.deps.store.update(id, p));
  }

  private enqueue(task: () => Promise<void>): Promise<void> {
    this.chain = this.chain.then(task).catch(noop);
    return this.chain;
  }

  // ── check loop ──────────────────────────────────────────

  private armCheck(): void {
    if (this.disposed) return;
    this.checkTimer = this.deps.clock.setTimeout(() => {
      this.armCheck();
      void this.enqueue(() => this.check());
    }, CHECK_EVERY_MS);
  }

  private allowed(now: Date): boolean {
    const { settings, isDoNotDisturb, isUserBusy } = this.deps;
    const s = settings().nudges;
    if (!s.enabled) return false;
    if (isQuietTime(now, s.quietStart, s.quietEnd)) return false;
    if (isDoNotDisturb?.()) return false;
    if (isUserBusy()) return false;
    const windowStart = now.getTime() - HOUR_MS;
    while (this.batchTimes.length > 0 && this.batchTimes[0]! <= windowStart) this.batchTimes.shift();
    return this.batchTimes.length < s.maxPerHour;
  }

  private async check(): Promise<void> {
    if (this.disposed) return;
    await this.writes;
    const now = new Date(this.deps.clock.now());
    const due = this.stillDue(await this.deps.store.due(now), now);
    if (due.length === 0 || !this.allowed(now)) return;
    await this.fireBatch(due, now);
  }

  /** Drops rows this engine changed since the store was read (cancelled, snoozed, ...). */
  private stillDue(rows: Nudge[], now: Date): Nudge[] {
    const out: Nudge[] = [];
    for (const row of rows) {
      const known = this.mirror.get(row.id);
      if (!known) {
        this.mirror.set(row.id, copy(row));
        out.push(row);
      } else if ((known.state === 'pending' || known.state === 'snoozed') && known.askAt.getTime() <= now.getTime()) {
        out.push(known);
      }
    }
    return out;
  }

  private async fireBatch(nudges: Nudge[], now: Date): Promise<void> {
    this.batchTimes.push(now.getTime());
    const batch = nudges.map((n) => ({ ...copy(n), state: 'fired' as const }));
    for (const n of batch) {
      this.patch(n.id, { state: 'fired' });
      this.deps.bus.emit({ type: 'nudge.fire', agentId: 'chipmunk', nudgeId: n.id, kind: n.kind, about: n.about });
    }
    for (const cb of this.callbacks) {
      try {
        cb(batch.map(copy));
      } catch {
        // one bad listener must not stop the others
      }
    }
    for (const n of batch) {
      if (n.source === 'rule' && isRuleKind(n.kind)) await this.ensureRule(n.kind, this.nextRuleTime(n.kind, n.askAt));
    }
  }

  // ── rule nudges ─────────────────────────────────────────

  private quietEndMinutes(): number {
    return parseClock(this.deps.settings().nudges.quietEnd) ?? 8 * 60;
  }

  private nextRuleTime(kind: RuleKind, firedFor: Date): Date {
    const now = this.deps.clock.now();
    const qe = this.quietEndMinutes();
    const step = kind === 'weekly' ? 7 : 1;
    const [hour, minute] = kind === 'daily' ? [Math.floor(qe / 60), qe % 60] : kind === 'evening' ? [EVENING_HOUR, 0] : [WEEKLY_HOUR, 0];
    let next = atLocal(firedFor, step, hour, minute);
    while (next.getTime() <= now) next = atLocal(next, step, hour, minute);
    return next;
  }

  private async ensureRule(kind: RuleKind, askAt: Date): Promise<void> {
    if (this.disposed) return;
    await this.writes;
    const existing = await this.deps.store.findByEvent(ruleKey(kind, askAt), kind);
    if (existing) {
      if (!this.mirror.has(existing.id)) this.mirror.set(existing.id, existing);
      return;
    }
    this.schedule({ kind, ...RULE_TEXT[kind], askAt, eventId: ruleKey(kind, askAt), source: 'rule' });
  }

  private async initRules(): Promise<void> {
    const now = new Date(this.deps.clock.now());
    const qe = this.quietEndMinutes();

    // Past quiet hours: ask now, unless today's check-in already exists (the next one is scheduled when it fires).
    const dailyToday = atLocal(now, 0, Math.floor(qe / 60), qe % 60);
    await this.ensureRule('daily', now.getTime() >= dailyToday.getTime() ? now : dailyToday);

    const eveningToday = atLocal(now, 0, EVENING_HOUR, 0);
    await this.ensureRule('evening', eveningToday.getTime() >= now.getTime() ? eveningToday : atLocal(now, 1, EVENING_HOUR, 0));

    let weekly = atLocal(now, (7 + SUNDAY - now.getDay()) % 7, WEEKLY_HOUR, 0);
    if (weekly.getTime() < now.getTime()) weekly = atLocal(weekly, 7, WEEKLY_HOUR, 0);
    await this.ensureRule('weekly', weekly);
  }

  // ── planner ─────────────────────────────────────────────

  private armMidnight(): void {
    if (this.disposed) return;
    const now = new Date(this.deps.clock.now());
    const wait = atLocal(now, 1, 0, 0).getTime() - now.getTime();
    this.midnightTimer = this.deps.clock.setTimeout(() => {
      this.armMidnight();
      void this.runPlanner();
    }, wait);
  }

  private async runPlanner(): Promise<void> {
    if (this.disposed || this.plannerRunning) return;
    this.plannerRunning = true;
    if (this.retryTimer !== undefined) {
      this.deps.clock.clearTimeout(this.retryTimer);
      this.retryTimer = undefined;
    }
    try {
      await this.plan();
    } catch {
      if (!this.disposed) {
        this.retryTimer = this.deps.clock.setTimeout(() => {
          this.retryTimer = undefined;
          void this.runPlanner();
        }, PLANNER_RETRY_MS);
      }
    } finally {
      this.plannerRunning = false;
    }
  }

  private async plan(): Promise<void> {
    const { clock, calendar, llm, store, chipAssistantId } = this.deps;
    const now = new Date(clock.now());
    const events = await calendar.listEvents(now, new Date(now.getTime() + 7 * DAY_MS));
    if (events.length === 0) return;

    const res = await llm.send({
      assistantId: chipAssistantId,
      content: buildPlannerPrompt(events, now),
      memory: 'off',
      jsonOutput: true,
    });
    const items = parsePlannerContent(res.content);

    const ids = new Set(events.map((e) => e.id));
    for (const item of items) {
      if (this.disposed) return;
      if (typeof item !== 'object' || item === null) continue;
      const r = item as Record<string, unknown>;
      const { eventId, kind, askAt, question, about } = r;
      if (typeof eventId !== 'string' || !ids.has(eventId)) continue;
      if (kind !== 'before' && kind !== 'after') continue;
      if (typeof askAt !== 'string' || typeof question !== 'string' || typeof about !== 'string') continue;
      if (!question.trim() || !about.trim()) continue;
      const when = new Date(askAt);
      if (Number.isNaN(when.getTime()) || when.getTime() < clock.now()) continue;

      await this.writes;
      if (await store.findByEvent(eventId, kind)) continue;
      this.schedule({ kind, about: about.trim(), question: question.trim(), askAt: when, eventId, source: 'planner' });
    }
  }
}
