# WARDEN-A: Approvals

**Branch:** `lane/warden-logic-a`. **Read first:** `docs/lanes/WARDEN-COMMON.md`.

## Owned paths (only these)
- `src/main/wolf/approvals.ts`
- `tests/warden-approvals.test.ts`

## Build
`createApprovals(deps): Approvals` (spec section 5; Chip spec section 3 help jobs, section 4.1 pause/resume, section 9 step 1: stop cancels approvals).
- `request` emits `approval.request { callId, title, preview }` plus `agent.status waiting_approval` for the asking animal, then waits.
- Abort through the request `signal` gives outcome `cancelled`.
- A 5 minute timeout on the injected Clock that starts when the card is visible gives outcome `timeout`, treated as declined.
- W15 queue: one visible card per job, at most 3 on screen, FIFO; the rest stay pending with their clock still paused.
- **Ref-counted** `jobs.pauseClock/resumeClock`: two asks in one job keep the clock paused until both settle. The scheduler's pause is a boolean, so count on YOUR side and call it only on 0-to-1 and 1-to-0. A help job's ask also pauses the asking job (find it through `jobs.list()`).
- Emits `approval.resolve { callId, approved, how }`.
- Reports declines to the gate (for W9) through an injected callback.
- `resolve` on an unknown or settled callId is ignored. Also `cancelForJobs`, `pending`, and `dispose` (declines everything).

## Tests (`tests/warden-approvals.test.ts`)
W-18 timeout; W-19 abort gives cancelled; W-20 a 4 minute approval does not time out the job (use the real `createJobScheduler` and the FakeClock); W-29 two asks in one job; W-30 a help job pauses both jobs; W15 queue (4 requests across 2 jobs: correct order, at most 3 visible); unknown callId ignored; dispose declines all.
