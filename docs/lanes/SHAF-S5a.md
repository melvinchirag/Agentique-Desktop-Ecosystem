# SHAF-S5a — Tiger schema SQL + migration runner
**Branch:** `lane/chip-sponsors-s5a` · **Spec:** `docs/ARCHITECTURE.md` §6, `docs/SPONSORS.md` §4.1 · **Engine:** Codex GPT-6 Sol, effort high

## Objective
One idempotent SQL file holding the whole ADE Tiger schema, and a runner that applies it.

## Owned paths
`scripts/tiger-schema.sql`, `scripts/tiger-migrate.ts`

## Steps
1. `scripts/tiger-schema.sql` — everything, safe to run twice:
   - `biome_events` hypertable (`by_range('ts')`) + indexes `ix_events_task`, `ix_events_type` (ARCHITECTURE §6, verbatim columns)
   - compression (segment by `agent_id`, policy 7 days) and retention (90 days), added only if not already present
   - continuous aggregates `agent_activity_5m`, `mood_daily`, `job_stats_daily`, each with a refresh policy (`if_not_exists => TRUE`)
   - views `wolf_audit`, `job_history`, `user_mood_timeline`
   - tables `nudges` (plus `event_id TEXT` and a unique constraint on `(event_id, kind)`), `file_ops`, `plan_items`, `drafts_log`, `research_log` (SPONSORS §4.1, verbatim columns)
2. `scripts/tiger-migrate.ts` — reads `TIGER_DATABASE_URL` from `.env`, runs the SQL with `pg`, prints each object created/kept, exits non-zero on error. Supports `--schema <name>` (creates the schema and sets `search_path`) so tests can use a throwaway schema such as `ade_test`.
3. TLS: keep certificate verification ON. Tiger Cloud signs with its own CA (`ca.timescale.com`), which Node does not trust by default. If env `TIGER_CA_FILE` is set, pass its contents as `ssl.ca`. Strip `sslmode` and related params from the URL before handing it to `pg`. On a certificate error, print a one-line fix hint. Never set `rejectUnauthorized: false`.
4. Continuous aggregates cannot be created inside a transaction; run those statements outside one. `CREATE MATERIALIZED VIEW ... WITH (timescaledb.continuous)` should use `IF NOT EXISTS` and `WITH NO DATA`.
5. Never print the connection string; redact it from error messages.

## Tests / done when
Runs twice in a row against Tiger Cloud with no error (`TIGER_CA_FILE=.tiger-ca.pem npx tsx scripts/tiger-migrate.ts --schema ade_test`), and a listing query shows every object. Then drop `ade_test`.

## STOP if
The service's TimescaleDB version rejects the compression/retention/continuous-aggregate syntax in the docs. Report the version (`SELECT extversion FROM pg_extension WHERE extname='timescaledb'`) and the exact error.

## Rules for every lane
- Touch ONLY the owned paths below. Never edit `src/shared/*` or `src/main/runtime/types.ts`.
- Never print, log, or commit key values, `.env`, or connection strings. Read secrets from `.env` at the repo root (`BACKBOARD_API_KEY`, `ELEVENLABS_API_KEY`, `TIGER_DATABASE_URL`).
- Plain TypeScript, Node 22+, ES modules, runnable with `npx tsx <file>`. Use built-in `fetch`; no vendor SDKs. Only extra dependency allowed: `pg`.
- No `package.json` exists on `main` yet (Melvin adds it with the contracts). Do NOT commit one; note needed deps in your final report.
- Deny any MCP/connector tool call. If a real API differs from the docs, STOP and report the exact response; do not guess.
- Commit on your lane branch with message `chip(sponsors): <what>`. Do not push.
- Final report: files changed, commands run with results, anything unverified.
