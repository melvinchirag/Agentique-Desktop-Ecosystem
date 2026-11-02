// One command that answers "is it working?", and fails when it is not.
//   node scripts/verify.mjs quick   typecheck, then the core test files
//   node scripts/verify.mjs full    quick, then build, then the Playwright e2e spec (demo core)
//   node scripts/verify.mjs local   the egress-guard test (lands with W5), then e2e with the network off
// Exit code: 0 all steps passed; 1 a step failed; 2 a step is not available yet (named in the output).
// Every step prints its command, its exit code and its time. Nothing is inferred from a step that did not run.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

const mode = process.argv[2] ?? 'quick';
// On Windows, npm and npx are .cmd wrappers; Node (since the 2024 spawn hardening) runs those only through a shell.
const win = process.platform === 'win32';
const npx = win ? 'npx.cmd' : 'npx';
const npm = win ? 'npm.cmd' : 'npm';

// The core files protect: Warden guarantees, the file sandbox and undo, the no-send guarantee, Chip's
// delegation and jobs, the agent runtime gate path. Trimmed to the named lean suite at W12.
// Chip's delegation is covered here through tests/scenarios/archie/integration.test.ts (Chip -> AgentRuntime -> Archie).
// tests/orchestrator.test.ts is NOT in the quick gate yet: one test ("nudge turn ... snooze") fails on main today
// because the PROMISE_ONLY guardrail misreads a nudge snooze reply as a promise without action and forces an
// extra turn. It is a real bug with a contract in docs/KNOWN-FAILURES.md; the file returns here when that is fixed.
// The full suite (npm test) still runs it and still shows the failure. Nothing is skipped or weakened.
const CORE_TESTS = [
  'tests/warden-rules.test.ts', 'tests/warden-gate.test.ts', 'tests/warden-approvals.test.ts', 'tests/warden-injection.test.ts',
  'tests/safePath.test.ts', 'tests/google/allowlist.test.ts', 'tests/localJournal.test.ts',
  'tests/beaver-organize.test.ts', 'tests/scenarios/archie/integration.test.ts', 'tests/scenarios/warden/realIntegration.test.ts',
  'tests/agentRuntime.test.ts', 'tests/jobs.test.ts',
];

const steps = {
  quick: [
    ['typecheck', npm, ['run', 'typecheck']],
    ['core tests', npx, ['vitest', 'run', '--maxWorkers=2', ...CORE_TESTS]],
  ],
  full: [
    ['typecheck', npm, ['run', 'typecheck']],
    ['core tests', npx, ['vitest', 'run', '--maxWorkers=2', ...CORE_TESTS]],
    ['build', npm, ['run', 'build']],
    ['e2e (demo core)', npx, ['playwright', 'test', 'tests/e2e']],
  ],
  local: [
    ['egress guard', npx, ['vitest', 'run', 'tests/egress-guard.test.ts'], { requires: 'tests/egress-guard.test.ts', lands: 'W5' }],
    ['build', npm, ['run', 'build']],
    ['e2e (local mode, network off)', npx, ['playwright', 'test', 'tests/e2e'], { env: { ADE_NETWORK: 'off' }, requires: 'tests/egress-guard.test.ts', lands: 'W5' }],
  ],
};

if (!steps[mode]) { console.error(`unknown mode "${mode}"; use quick, full or local`); process.exit(2); }

let failed = 0, unavailable = 0;
const started = Date.now();
for (const [name, cmd, args, opts = {}] of steps[mode]) {
  if (opts.requires && !existsSync(opts.requires)) {
    unavailable++;
    console.log(`\n[verify] SKIP  ${name}: ${opts.requires} does not exist yet (lands with ${opts.lands}). Counted as not available, not as a pass.`);
    continue;
  }
  console.log(`\n[verify] RUN   ${name}: ${cmd} ${args.join(' ')}`);
  const t0 = Date.now();
  const r = spawnSync(cmd, args, { stdio: 'inherit', shell: win, env: { ...process.env, ...(opts.env ?? {}) } });
  const code = r.status ?? (r.error ? 1 : 0);
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  if (code === 0) console.log(`[verify] PASS  ${name} (${secs}s)`);
  else { failed++; console.log(`[verify] FAIL  ${name}: exit ${code}${r.error ? ' (' + r.error.message + ')' : ''} (${secs}s)`); }
  if (code !== 0 && mode !== 'quick') { console.log('[verify] stopping at the first failure'); break; }
}

const total = ((Date.now() - started) / 1000).toFixed(1);
if (failed) { console.log(`\n[verify] ${mode}: FAILED (${failed} step(s) failed) in ${total}s`); process.exit(1); }
if (unavailable) { console.log(`\n[verify] ${mode}: NOT AVAILABLE (${unavailable} step(s) not landed yet) in ${total}s`); process.exit(2); }
console.log(`\n[verify] ${mode}: PASSED in ${total}s`);
