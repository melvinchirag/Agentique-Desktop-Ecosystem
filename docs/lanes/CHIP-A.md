# Lane A: JobScheduler

**Engine:** Codex · GPT-6 Sol · high · **Backup:** Claude Opus 5.5 medium · **Floor:** strong
**Branch:** `lane/chip-logic-a` · **First read:** `docs/lanes/README.md` (rules for every lane)

## Objective
Build the JobScheduler: every animal's job queue. Different animals work in parallel; one animal does one normal job at a time; help jobs skip the line. It emits the job events the renderer animates.

## Owned paths (only these)
- `src/main/runtime/jobs.ts`
- `tests/jobs.test.ts`

## Read
Chip spec `docs/agents/01-chip-orchestrator.md`: **§3** (help jobs), **§4.1** (jobs), **§4.2** (presence: wake rules), **§7** (`Job`, `JobScheduler`, `SpecialistRunner`, `PresenceManager`), **§8** rows "Job submitted…", "Help job", "Job finishes", **§10.6** (ask_teammate). Interfaces: `src/main/runtime/types.ts`.

## Build
Export:
```ts
export interface JobSchedulerDeps {
  bus: Bus; clock: Clock; runner: SpecialistRunner; presence: PresenceManager;
  settings: () => AdeSettings;
  newId?: () => string;            // default crypto.randomUUID
}
export function createJobScheduler(deps: JobSchedulerDeps): JobScheduler;
export const NORMAL_JOB_TIMEOUT_MS = 180_000;
export const HELP_JOB_TIMEOUT_MS = 60_000;
export function normalizeTitle(title: string): string;   // lowercase, trim, strip punctuation, collapse spaces
```

`submit(j)` decides synchronously and returns at once. Starting the job is async.
1. `settings().installed[j.agent]` is false → `{ status: 'not_installed' }`. No events.
2. **Duplicate** (normal jobs only): same agent + same `normalizeTitle(title)` as a *running or queued* normal job → `{ status: 'duplicate', jobId: <existing> }`. No events.
3. **Help job** (`kind: 'help'`): always starts immediately, even if the helper has a running normal job. Help jobs never enter or block the queue.
4. **Normal job**, the agent already has a running normal job → append to that agent's FIFO → `{ status: 'queued', jobId, position }` (1 = next) and emit `job.update(queued, position)`. When positions shift later, emit `job.update(queued, newPosition)` for each job that moved.
5. Otherwise it starts now. Status is `'woke_and_started'` if `presence.get(agent) === 'docked'`, else `'started'`.

**Starting a job** (in this order):
1. If presence is `docked` or `sleeping` → `await presence.wake(agent, 'job')`.
2. `presence.setBusy(agent, true)`.
3. Emit `job.update(running)` → `agent.handoff` (README event conventions; `via: 'ants'` if `planStep` is set).
4. `runner.run(agent, task, { jobId, taskId: parentTaskId, kind, signal })` with an AbortController per job.
5. Arm the **working-time** timeout (180 s normal / 60 s help) on the Clock.

**Working-time timeout:** `pauseClock(jobId)` clears the timer and remembers the remaining ms; `resumeClock(jobId)` re-arms it with the remainder. Both are no-ops for unknown or finished jobs, and pausing twice is a no-op. When the timeout fires: abort the job's signal, then finish it as failed: `{ ok: false, say: "I ran out of time.", bubble: "Timed out", summary: "Timed out after 180 s.", artifacts: [] }` (60 s for help jobs).

**Finishing a job** (runner resolved, or threw, or timed out):
- A runner that throws becomes `{ ok: false, say: "Something went wrong.", bubble: "Oops", summary: <error message>, artifacts: [] }`.
- State is `done` when `result.ok` is true, else `failed`.
- Emit in this order: `agent.say(report, result.say, result.bubble)` → `agent.return(to: requestedBy, ok, summary)` → `job.update(done | failed)`.
- `presence.setBusy(agent, false)` and `presence.touch(agent)`.
- Call every `onFinished` callback (each in try/catch) and resolve `waitFor(jobId)`.
- If it was a normal job, start the next queued job for that agent.
- Ignore a runner result that arrives after the job was cancelled or timed out.

**`cancel(filter)`:** `{ all: true }` = every running and queued job; `{ agent }` = that animal's jobs only. Running jobs: abort the signal and clear the timeout. Queued jobs: drop them. Emit `job.update(cancelled)` for each; `setBusy(agent, false)`. **Cancelled jobs do not call `onFinished`, and do not emit `agent.say` or `agent.return`.** `waitFor` on a cancelled job resolves `{ ok: false, say: '', bubble: '', summary: 'Cancelled.', artifacts: [] }`. Return the number cancelled. Do not start queued jobs for an agent whose queue you are cancelling.

**`waitFor(jobId)`:** resolves with the job's result (also if the job already finished). Unknown jobId → reject.

**`list()`:** running + queued jobs (copies), plus jobs finished in the last 10 minutes.

## Tests (`tests/jobs.test.ts`, FakeClock + a fake `SpecialistRunner` + a fake `PresenceManager` you write inside the test file)
1. **C3 parallel:** Scout job running, Pixel job submitted → Pixel `started` immediately; both run at once.
2. **C4 queue:** second Scout job → `queued`, position 1; runs after the first finishes; `job.update(queued, 1)` then `job.update(running)` later.
3. **C5 duplicate:** same title with different case/punctuation → `duplicate` with the existing jobId; no new events.
4. **C7 help bypass:** Archie busy with a normal job; a help job for Archie starts immediately; runner receives `kind: 'help'`; `waitFor` resolves with the result.
5. **C8 cancel one:** jobs for Scout and Pixel; `cancel({ agent: 'eagle' })` → only Scout's cancelled (running aborted, queued dropped); Pixel continues.
6. `cancel({ all: true })` cancels everything; no `agent.say`/`agent.return` for cancelled jobs; `onFinished` not called.
7. **C10 auto-wake:** docked Swarm → `woke_and_started`; `presence.wake('ants','job')` called **before** `runner.run`.
8. **C11 approval pause:** `pauseClock` at 10 s, `advanceAsync(4 min)`, `resumeClock` → not timed out; finishes normally after.
9. Timeout fires at exactly 180 s of working time (not 179 s); help timeout at 60 s; the signal is aborted.
10. Event order on start and finish matches §8; `via: 'ants'` appears only when `planStep` is set.
11. Runner throws → `failed`, the next queued job starts.
12. `not_installed` for an extra (`butterfly`) with default settings; no events.
13. `setBusy(true)` on start, `setBusy(false)` + `touch` on finish.

## STOP if
- `types.ts` can't express something you need.
- Any rule above conflicts with the spec in a way you can't resolve.
