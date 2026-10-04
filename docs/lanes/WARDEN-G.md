# WARDEN-G: rule engine and gate (security-critical)

**Branch:** `lane/warden-logic-g`. **Read first:** `docs/lanes/WARDEN-COMMON.md`.

## Owned paths (only these)
- `src/main/wolf/rules.ts`
- `src/main/wolf/inspect.ts`
- `src/main/wolf/gate.ts`
- `tests/warden-rules.test.ts`
- `tests/warden-gate.test.ts`

## Build
Spec sections 3, 4, 12 and 15; Archie spec sections 2, 4 and 13.
- Pure `evaluate(req, ctx)` implementing rules W0 to W16 **in the section 3 order** (stable ids, never renumber).
- Generic argument scan plus the tool's `inspect` merged. Effective risk is the max of declared and inspected.
- Independent W5 path check: Archie section 2 relative-path resolution, injected `realpath` / `exists`, case-insensitive, separator boundary, section 2.5 exclusions, the ADE Trash write rule.
- W1 send/share name-segment match **before** W10 unknown-tool (decision 11). `fs_propose_plan` must NOT match W1.
- W7 and W12 lists. Per-job W9 state, per-task W16 taint.
- `createWardenGate(deps): WardenGate`: `review` is **synchronous**, emits `wolf.verdict` from `'wolf'`; also `explain(callId)`, `taint(taskId)`, `noteDeclined(jobId, callKey)`; clears per-job state on `job.update` done / failed / cancelled through the bus.
- **W0 fail-closed wrapper**: any exception inside the gate returns deny with rule W0.

## Tests
- `tests/warden-rules.test.ts`: W-1 to W-17 from `tests/fixtures/warden/rule-matrix.json` **if it exists on your branch** (lane X's output; the orchestrator merges it before G is audited). Until then write your own matrix inline and keep it easy to swap.
- `tests/warden-gate.test.ts`: W-26 fail-closed, W-27 speed (hundreds of reviews in a few ms), W-33, W-34, W-35, W-37 (Pixel demo-mode send probe through the real gate: W1 deny before W10, a probe-labelled audit row, absent in normal mode), and a type test that `StubWardenGate` is assignable to `WardenGate`.
- Path tests use `makeSandbox` (temp dir), never a real folder.
