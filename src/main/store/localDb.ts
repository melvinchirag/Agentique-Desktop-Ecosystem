/**
 * ADE's own data, in one SQLite file on the user's machine: %APPDATA%\ADE\ade.db.
 * Built-in `node:sqlite` (Electron 44 ships Node 24 with SQLite 3.53), so there is nothing to install.
 * Replaces Tiger Cloud (events, audit, replay, pulse) and Backboard (memories, conversation threads).
 */
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export type LocalDb = DatabaseSync;

const RETENTION_DAYS = 90;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS events (
  rowid INTEGER PRIMARY KEY, ts INTEGER NOT NULL, id TEXT UNIQUE NOT NULL, session_id TEXT,
  task_id TEXT, agent_id TEXT, type TEXT NOT NULL, call_id TEXT, payload TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_events_ts ON events (ts);
CREATE INDEX IF NOT EXISTS ix_events_task ON events (task_id, ts);
CREATE INDEX IF NOT EXISTS ix_events_type ON events (type, ts);
CREATE INDEX IF NOT EXISTS ix_events_call ON events (call_id, type);

CREATE TABLE IF NOT EXISTS memories (
  id TEXT PRIMARY KEY, agent_id TEXT NOT NULL, content TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_memories_agent ON memories (agent_id, updated_at);

CREATE TABLE IF NOT EXISTS thread_messages (
  rowid INTEGER PRIMARY KEY, thread_id TEXT NOT NULL, role TEXT NOT NULL, content TEXT NOT NULL,
  tool_calls TEXT, tool_call_id TEXT, ts INTEGER NOT NULL, tokens INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_thread ON thread_messages (thread_id, rowid);
`;

/** Opens (or creates) the database. `file` = ':memory:' for tests. Purges events older than 90 days. */
export function openLocalDb(file: string, now: () => number = () => Date.now()): LocalDb {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA);
  db.prepare('DELETE FROM events WHERE ts < ?').run(now() - RETENTION_DAYS * 86_400_000);
  return db;
}

export const localDbPath = (dataDir: string): string => join(dataDir, 'ade.db');

/** Runs `fn` in one transaction. */
export function tx<T>(db: LocalDb, fn: () => T): T {
  db.exec('BEGIN');
  try { const out = fn(); db.exec('COMMIT'); return out; }
  catch (e) { db.exec('ROLLBACK'); throw e; }
}
