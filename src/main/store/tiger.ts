import { appendFileSync, existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import pg from 'pg';
import type { BiomeEvent } from '../../shared/events';
import type { Bus, EventSink } from '../runtime/types';

/** The one thing every Tiger store needs. A pg.Pool fits; tests pass a fake. */
export interface Db { query(text: string, params?: unknown[]): Promise<{ rows: any[] }> }

type Env = Record<string, string | undefined>;
type Log = (message: string) => void;

/** Never let a connection string reach a log. */
export function redact(message: unknown): string {
  return String(message).replace(/postgres(?:ql)?:\/\/\S+/gi, '[database url]');
}

/** %APPDATA%/ADE on Windows, ~/.ade elsewhere. */
export function adeDataDir(env: Env = process.env): string {
  return env.APPDATA ? join(env.APPDATA, 'ADE') : join(homedir(), '.ade');
}

/**
 * pg options with verified TLS. Tiger Cloud signs with its own CA, so set TIGER_CA_FILE to the
 * CA certificate (.pem); verification is never turned off (docs/sponsor-verify.md §T2).
 */
export function tigerPoolConfig(env: Env = process.env, baseDir = process.cwd()): pg.PoolConfig {
  const raw = env.TIGER_DATABASE_URL;
  if (!raw) throw new Error('TIGER_DATABASE_URL is missing');
  const url = new URL(raw);
  for (const key of ['sslmode', 'ssl', 'sslcert', 'sslkey', 'sslrootcert']) url.searchParams.delete(key);
  const caFile = env.TIGER_CA_FILE;
  const ca = caFile ? readFileSync(isAbsolute(caFile) ? caFile : resolve(baseDir, caFile), 'utf8') : undefined;
  return { connectionString: url.toString(), ssl: { rejectUnauthorized: true, ...(ca ? { ca } : {}) }, connectionTimeoutMillis: 10_000, max: 4 };
}

export function createTigerPool(env: Env = process.env, baseDir?: string): pg.Pool {
  const pool = new pg.Pool(tigerPoolConfig(env, baseDir));
  pool.on('error', () => {});                              // an idle-client error must never crash the app
  return pool;
}

// ── Event rows ────────────────────────────────────────────

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_PAYLOAD_BYTES = 4096;

export interface EventRow { ts: string; id: string; session_id: string; task_id: string | null; agent_id: string; type: string; payload: Record<string, unknown> }

/** BiomeEvent → biome_events row. Returns a reason string when the event must not be stored. */
export function toRow(e: BiomeEvent): EventRow | string {
  const { id, ts, sessionId, taskId, agentId, type, ...payload } = e as BiomeEvent & Record<string, unknown>;
  if (!UUID.test(id) || !UUID.test(sessionId)) return 'id or sessionId is not a UUID';
  const body: Record<string, unknown> = payload;
  let task_id: string | null = null;
  if (taskId !== undefined) {
    if (UUID.test(taskId)) task_id = taskId;
    else body._taskId = taskId;                            // keep it, but the column only takes UUIDs
  }
  // Privacy: events carry subjects, counts, and summaries. Anything this big is probably an email body or file text.
  if (Buffer.byteLength(JSON.stringify(body)) > MAX_PAYLOAD_BYTES) return `payload over ${MAX_PAYLOAD_BYTES} bytes`;
  return { ts: new Date(ts).toISOString(), id, session_id: sessionId, task_id, agent_id: agentId, type, payload: body };
}

/** biome_events row → BiomeEvent (for Replay). */
export function fromRow(row: Record<string, any>): BiomeEvent {
  const { _taskId, ...payload } = (row.payload ?? {}) as Record<string, unknown>;
  const taskId = row.task_id ?? _taskId;
  return { ...payload, id: row.id, ts: new Date(row.ts).getTime(), sessionId: row.session_id, ...(taskId ? { taskId } : {}), agentId: row.agent_id, type: row.type } as BiomeEvent;
}

const INSERT_SQL = `INSERT INTO biome_events (ts, id, session_id, task_id, agent_id, type, payload)
SELECT ts, id, session_id, task_id, agent_id, type, payload
FROM jsonb_to_recordset($1::jsonb) AS x(ts timestamptz, id uuid, session_id uuid, task_id uuid, agent_id text, type text, payload jsonb)`;

export interface TigerEventSinkOptions {
  db: Db;
  /** Where rows wait while Tiger is unreachable. Default: <ADE data dir>/pending-events.jsonl */
  pendingFile?: string;
  flushIntervalMs?: number;      // default 500
  retryIntervalMs?: number;      // default 30_000
  maxBatch?: number;             // default 200
  log?: Log;
}

/**
 * Writes every biome event to Tiger (docs/SPONSORS.md §4.2).
 * Batches every 500 ms, at most 200 rows per insert. If Tiger is down, rows go to a local jsonl file
 * and are retried every 30 s. NEVER throws into the app.
 */
export class TigerEventSink implements EventSink {
  private readonly db: Db;
  private readonly pendingFile: string;
  private readonly flushIntervalMs: number;
  private readonly retryIntervalMs: number;
  private readonly maxBatch: number;
  private readonly log: Log;
  private buffer: EventRow[] = [];
  private flushTimer: ReturnType<typeof setInterval> | undefined;
  private retryTimer: ReturnType<typeof setInterval> | undefined;
  private chain: Promise<void> = Promise.resolve();
  private lastMicros = 0;

  constructor(opts: TigerEventSinkOptions) {
    this.db = opts.db;
    this.pendingFile = opts.pendingFile ?? join(adeDataDir(), 'pending-events.jsonl');
    this.flushIntervalMs = opts.flushIntervalMs ?? 500;
    this.retryIntervalMs = opts.retryIntervalMs ?? 30_000;
    this.maxBatch = opts.maxBatch ?? 200;
    this.log = opts.log ?? ((m) => console.warn(`[tiger] ${m}`));
  }

  /** Subscribe to the bus so every event is stored. Returns the unsubscribe function. */
  attach(bus: Bus): () => void {
    return bus.subscribe((e) => this.enqueue(e));
  }

  enqueue(e: BiomeEvent): void {
    try {
      const row = toRow(e);
      if (typeof row === 'string') { this.log(`dropped ${e.type} event: ${row}`); return; }
      row.ts = this.orderedTs(e.ts);
      this.buffer.push(row);
      this.startTimers();
    } catch (err) { this.log(`enqueue failed: ${redact((err as Error).message)}`); }
  }

  /** Writes everything buffered so far. Resolves even if Tiger is down (rows go to the pending file). */
  flush(): Promise<void> {
    this.chain = this.chain.then(() => this.drain()).catch(() => {});
    return this.chain;
  }

  /** Tries to send rows that were saved while Tiger was unreachable. */
  retryPending(): Promise<void> {
    this.chain = this.chain.then(() => this.drainPending()).catch(() => {});
    return this.chain;
  }

  /** Stops the timers and writes what is left. */
  async dispose(): Promise<void> {
    if (this.flushTimer) clearInterval(this.flushTimer);
    if (this.retryTimer) clearInterval(this.retryTimer);
    this.flushTimer = this.retryTimer = undefined;
    await this.flush();
  }

  /**
   * Events emitted in the same millisecond would come back from `ORDER BY ts` in any order, which scrambles Replay.
   * Each stored timestamp is therefore at least 1 microsecond after the previous one. Reading floors back to the same millisecond.
   */
  private orderedTs(ms: number): string {
    this.lastMicros = Math.max(ms * 1000, this.lastMicros + 1);
    const micros = this.lastMicros % 1000;
    return new Date(Math.floor(this.lastMicros / 1000)).toISOString().replace('Z', String(micros).padStart(3, '0') + 'Z');
  }

  private startTimers(): void {
    if (!this.flushTimer) { this.flushTimer = setInterval(() => void this.flush(), this.flushIntervalMs); this.flushTimer.unref?.(); }
    if (!this.retryTimer) { this.retryTimer = setInterval(() => void this.retryPending(), this.retryIntervalMs); this.retryTimer.unref?.(); }
  }

  private async drain(): Promise<void> {
    while (this.buffer.length) {
      const batch = this.buffer.splice(0, this.maxBatch);
      try { await this.db.query(INSERT_SQL, [JSON.stringify(batch)]); }
      catch (err) {
        this.log(`insert failed, ${batch.length} event(s) saved locally: ${redact((err as Error).message)}`);
        this.savePending(batch);
      }
    }
  }

  private savePending(rows: EventRow[]): void {
    try {
      mkdirSync(dirname(this.pendingFile), { recursive: true });
      appendFileSync(this.pendingFile, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
    } catch (err) { this.log(`could not save pending events: ${(err as Error).message}`); }
  }

  private async drainPending(): Promise<void> {
    if (!existsSync(this.pendingFile)) return;
    let rows: EventRow[];
    try {
      rows = readFileSync(this.pendingFile, 'utf8').split('\n').filter(Boolean).flatMap((line) => { try { return [JSON.parse(line) as EventRow]; } catch { return []; } });
    } catch (err) { this.log(`could not read pending events: ${(err as Error).message}`); return; }
    let sent = 0;
    try {
      for (; sent < rows.length; sent += this.maxBatch) await this.db.query(INSERT_SQL, [JSON.stringify(rows.slice(sent, sent + this.maxBatch))]);
    } catch { /* still down: keep what was not sent */ }
    try {
      const left = rows.slice(sent);
      if (left.length) writeFileSync(this.pendingFile, left.map((r) => JSON.stringify(r)).join('\n') + '\n');
      else unlinkSync(this.pendingFile);
    } catch (err) { this.log(`could not update pending events: ${(err as Error).message}`); }
  }
}
