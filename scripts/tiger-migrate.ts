// Applies scripts/tiger-schema.sql to Tiger Cloud. Safe to run twice.
//   npx tsx scripts/tiger-migrate.ts                     apply to the default schema
//   npx tsx scripts/tiger-migrate.ts --schema ade_test   apply to a throwaway schema (for tests)
//   npx tsx scripts/tiger-migrate.ts --schema ade_test --drop   drop that schema
// TLS stays verified. Tiger Cloud signs with its own CA, so set TIGER_CA_FILE to the CA certificate (.pem).
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { redact, tigerPoolConfig } from '../src/main/store/tiger';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function readEnv(): Record<string, string> {
  const out: Record<string, string> = {};
  const path = join(ROOT, '.env');
  if (!existsSync(path)) return out;
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m) out[m[1]] = m[2].trim().replace(/^"(.*)"$/, '$1');
  }
  return out;
}

/** Split a SQL file into statements. The schema has no functions or DO blocks, so splitting on ';' is safe. */
export function splitStatements(sql: string): string[] {
  return sql.split('\n').filter(line => !line.trim().startsWith('--')).join('\n')
    .split(/;\s*(?:\n|$)/).map(s => s.replace(/--.*$/gm, '').trim()).filter(Boolean);
}

const label = (stmt: string) => stmt.replace(/\s+/g, ' ').slice(0, 78);

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const at = args.indexOf('--schema');
  const schema = at >= 0 ? args[at + 1] : undefined;
  if (schema !== undefined && !/^[a-z_][a-z0-9_]*$/.test(schema)) throw new Error('--schema must be a plain lowercase name');
  const client = new pg.Client(tigerPoolConfig({ ...readEnv(), ...process.env }, ROOT));
  try { await client.connect(); }
  catch (e: any) {
    const hint = /certificate|self.signed/i.test(e.message)
      ? ' Fix: download the CA certificate from the Tiger Cloud service page and set TIGER_CA_FILE=<path to .pem> in .env.' : '';
    throw new Error(redact(e.message) + hint);
  }
  try {
    const version = await client.query("SELECT extversion FROM pg_extension WHERE extname = 'timescaledb'");
    console.log(`TimescaleDB ${version.rows[0]?.extversion ?? 'NOT INSTALLED'}`);
    if (schema && args.includes('--drop')) {
      await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      console.log(`dropped schema ${schema}`); return;
    }
    if (schema) {
      await client.query(`CREATE SCHEMA IF NOT EXISTS ${schema}`);
      await client.query(`SET search_path TO ${schema}, public`);
    }
    const statements = splitStatements(readFileSync(join(ROOT, 'scripts', 'tiger-schema.sql'), 'utf8'));
    for (const stmt of statements) {
      try { await client.query(stmt); console.log(`ok    ${label(stmt)}`); }
      catch (e: any) { console.error(`FAIL  ${label(stmt)}\n      ${redact(e.message)}`); process.exitCode = 1; return; }
    }
    const where = schema ? `'${schema}'` : 'current_schema()';
    const objects = await client.query(
      `SELECT table_name AS name, table_type AS kind FROM information_schema.tables WHERE table_schema = ${where}
       UNION ALL SELECT view_name, 'CONTINUOUS AGGREGATE' FROM timescaledb_information.continuous_aggregates WHERE view_schema = ${where}
       ORDER BY 1`);
    console.log(`\n${statements.length} statements applied. Objects:`);
    for (const row of objects.rows) console.log(`  ${row.name}  (${row.kind})`);
  } finally { await client.end(); }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch(e => { console.error(redact(e.message || String(e))); process.exit(1); });
}
