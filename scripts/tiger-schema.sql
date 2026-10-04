-- ADE Tiger Data schema. Idempotent: safe to run any number of times.
-- Source of truth: docs/ARCHITECTURE.md §6 and docs/SPONSORS.md §4.1.
-- Run with scripts/tiger-migrate.ts (each statement runs on its own, outside a transaction,
-- because continuous aggregates cannot be created inside one).

-- ── Core time series ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS biome_events (
  ts          TIMESTAMPTZ NOT NULL,
  id          UUID        NOT NULL,
  session_id  UUID        NOT NULL,
  task_id     UUID,
  agent_id    TEXT        NOT NULL,
  type        TEXT        NOT NULL,
  payload     JSONB       NOT NULL
);
SELECT create_hypertable('biome_events', by_range('ts'), if_not_exists => TRUE);
CREATE INDEX IF NOT EXISTS ix_events_task ON biome_events (task_id, ts);
CREATE INDEX IF NOT EXISTS ix_events_type ON biome_events (type, ts DESC);

ALTER TABLE biome_events SET (timescaledb.compress, timescaledb.compress_segmentby = 'agent_id');
SELECT add_compression_policy('biome_events', INTERVAL '7 days', if_not_exists => TRUE);
SELECT add_retention_policy('biome_events', INTERVAL '90 days', if_not_exists => TRUE);

-- ── Continuous aggregates (live stats) ───────────────────────────────────────
CREATE MATERIALIZED VIEW IF NOT EXISTS agent_activity_5m
WITH (timescaledb.continuous) AS
SELECT time_bucket('5 minutes', ts) AS bucket, agent_id,
       count(*) AS events,
       count(*) FILTER (WHERE type = 'tool.result') AS actions
FROM biome_events GROUP BY bucket, agent_id
WITH NO DATA;
-- Real-time: also include rows newer than the last refresh, so today's numbers show at once.
ALTER MATERIALIZED VIEW agent_activity_5m SET (timescaledb.materialized_only = false);
SELECT add_continuous_aggregate_policy('agent_activity_5m',
  start_offset => INTERVAL '1 day', end_offset => INTERVAL '1 minute',
  schedule_interval => INTERVAL '1 minute', if_not_exists => TRUE);

CREATE MATERIALIZED VIEW IF NOT EXISTS mood_daily
WITH (timescaledb.continuous) AS
SELECT time_bucket('1 day', ts) AS day, payload->>'mood' AS mood,
       count(*) AS times, avg((payload->>'intensity')::float) AS avg_intensity
FROM biome_events WHERE type = 'user.mood' GROUP BY day, mood
WITH NO DATA;
-- Real-time: also include rows newer than the last refresh, so today's numbers show at once.
ALTER MATERIALIZED VIEW mood_daily SET (timescaledb.materialized_only = false);
SELECT add_continuous_aggregate_policy('mood_daily',
  start_offset => INTERVAL '7 days', end_offset => INTERVAL '1 minute',
  schedule_interval => INTERVAL '5 minutes', if_not_exists => TRUE);

CREATE MATERIALIZED VIEW IF NOT EXISTS job_stats_daily
WITH (timescaledb.continuous) AS
SELECT time_bucket('1 day', ts) AS day, payload->>'to' AS agent,
       count(*) FILTER (WHERE payload->>'state' = 'done')   AS done,
       count(*) FILTER (WHERE payload->>'state' = 'failed') AS failed
FROM biome_events WHERE type = 'job.update' GROUP BY day, agent
WITH NO DATA;
-- Real-time: also include rows newer than the last refresh, so today's numbers show at once.
ALTER MATERIALIZED VIEW job_stats_daily SET (timescaledb.materialized_only = false);
SELECT add_continuous_aggregate_policy('job_stats_daily',
  start_offset => INTERVAL '7 days', end_offset => INTERVAL '1 minute',
  schedule_interval => INTERVAL '5 minutes', if_not_exists => TRUE);

-- Warden's verdicts and alerts per day, rule, and verdict (alerts count as verdict 'alert').
CREATE MATERIALIZED VIEW IF NOT EXISTS warden_daily
WITH (timescaledb.continuous) AS
SELECT time_bucket('1 day', ts) AS day,
       coalesce(payload->>'rule', '') AS rule,
       coalesce(payload->>'verdict', 'alert') AS verdict,
       count(*) AS times
FROM biome_events WHERE type IN ('wolf.verdict', 'wolf.alert') GROUP BY day, rule, verdict
WITH NO DATA;
ALTER MATERIALIZED VIEW warden_daily SET (timescaledb.materialized_only = false);
SELECT add_continuous_aggregate_policy('warden_daily',
  start_offset => INTERVAL '7 days', end_offset => INTERVAL '1 minute',
  schedule_interval => INTERVAL '5 minutes', if_not_exists => TRUE);

-- ── Views ────────────────────────────────────────────────────────────────────
-- Warden's audit trail. The first nine columns are the original ones, in order; asking_agent, tool, and how
-- are appended (03-warden-security.md §10). asking_agent + tool come from the tool.request with the same callId
-- (agent_id here is always Warden himself).
CREATE INDEX IF NOT EXISTS ix_events_call ON biome_events ((payload->>'callId'), ts DESC) WHERE type = 'tool.request';
CREATE OR REPLACE VIEW wolf_audit AS
SELECT e.ts, e.task_id, e.agent_id, e.type,
       e.payload->>'callId' AS call_id, e.payload->>'verdict' AS verdict,
       e.payload->>'rule' AS rule, e.payload->>'reason' AS reason, e.payload->>'approved' AS approved,
       r.agent_id AS asking_agent, r.tool AS tool, e.payload->>'how' AS how
FROM biome_events e
LEFT JOIN LATERAL (
  SELECT q.agent_id, q.payload->>'tool' AS tool FROM biome_events q
  WHERE q.type = 'tool.request' AND q.payload->>'callId' = e.payload->>'callId'
  ORDER BY q.ts DESC LIMIT 1
) r ON true
WHERE e.type IN ('wolf.verdict', 'wolf.alert', 'approval.resolve');

-- Jobs (Agent Hub status history)
CREATE OR REPLACE VIEW job_history AS
SELECT ts, payload->>'jobId' AS job_id, payload->>'to' AS agent, payload->>'state' AS state,
       payload->>'title' AS title, payload->>'requestedBy' AS requested_by
FROM biome_events WHERE type = 'job.update';

-- Mood over time
CREATE OR REPLACE VIEW user_mood_timeline AS
SELECT ts, payload->>'mood' AS mood, (payload->>'intensity')::float AS intensity
FROM biome_events WHERE type = 'user.mood';

-- ── Feature tables ───────────────────────────────────────────────────────────
-- Push-first nudges (Chip's follow-ups)
CREATE TABLE IF NOT EXISTS nudges (
  id UUID PRIMARY KEY, kind TEXT NOT NULL, about TEXT NOT NULL, question TEXT NOT NULL,
  ask_at TIMESTAMPTZ NOT NULL, state TEXT NOT NULL DEFAULT 'pending',   -- pending | fired | answered | snoozed | cancelled
  source TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE nudges ADD COLUMN IF NOT EXISTS event_id TEXT;
CREATE INDEX IF NOT EXISTS ix_nudges_due ON nudges (state, ask_at);
CREATE UNIQUE INDEX IF NOT EXISTS ux_nudges_event_kind ON nudges (event_id, kind);

-- Archie's undo journal
CREATE TABLE IF NOT EXISTS file_ops (
  id UUID PRIMARY KEY, ts TIMESTAMPTZ NOT NULL, job_id UUID, op TEXT NOT NULL,
  from_path TEXT, to_path TEXT, batch_id UUID, undone BOOLEAN DEFAULT false
);
CREATE INDEX IF NOT EXISTS ix_file_ops_batch ON file_ops (batch_id, ts DESC);
-- Archie's journal (02-archie-files.md §5): a 'swept' flag, and op may also be 'trash' or 'sweep' (op is free text).
-- Ids come from the local journal and are not guaranteed to be UUIDs, so they are stored as text.
ALTER TABLE file_ops ADD COLUMN IF NOT EXISTS swept BOOLEAN DEFAULT false;
ALTER TABLE file_ops ALTER COLUMN id TYPE TEXT;
ALTER TABLE file_ops ALTER COLUMN job_id TYPE TEXT;
ALTER TABLE file_ops ALTER COLUMN batch_id TYPE TEXT;

-- Swarm's plans (status: planned | done | moved | skipped)
CREATE TABLE IF NOT EXISTS plan_items (
  id UUID PRIMARY KEY, plan_date DATE NOT NULL, title TEXT NOT NULL,
  start_at TIMESTAMPTZ, end_at TIMESTAMPTZ, status TEXT DEFAULT 'planned'
);
CREATE INDEX IF NOT EXISTS ix_plan_items_date ON plan_items (plan_date);

-- Pixel's drafts, metadata only (state: waiting | sent | deleted)
CREATE TABLE IF NOT EXISTS drafts_log (
  id UUID PRIMARY KEY, ts TIMESTAMPTZ NOT NULL, gmail_draft_id TEXT,
  to_count INT, subject TEXT, state TEXT DEFAULT 'waiting'
);
CREATE INDEX IF NOT EXISTS ix_drafts_state ON drafts_log (state, ts);

-- Scout's research briefs
CREATE TABLE IF NOT EXISTS research_log (
  id UUID PRIMARY KEY, ts TIMESTAMPTZ NOT NULL, title TEXT, sources JSONB, brief_path TEXT
);
CREATE INDEX IF NOT EXISTS ix_research_ts ON research_log (ts DESC);
