# Warden lanes: rules every lane follows

**First read:** `docs/lanes/README.md` (owned paths only, never edit shared contracts, injected dependencies, no real folders, do not commit).
**Spec:** `docs/agents/03-warden-security.md` wins over everything else for Warden. The original lane descriptions are in `docs/agents/03-warden-BUILD-LANES.md` section 3.

**Engine actually used:** Claude Sonnet 5.5 high. Codex's Windows sandbox cannot write files and its usage limit was hit; Sonnet is in the same "strong" band the plan asks for. After each lane the orchestrator audits it, and a separate read-only Opus session reviews the security-critical ones (G, J, A).

**Already on your branch (do not edit):**
- Contracts in `src/main/runtime/types.ts`: `WardenVerdict`, `GateRequest`, `WardenGate`, `ApprovalHow`, `ApprovalOutcome`, `ApprovalRequest`, `Approvals`, `ScreenSource`, `ScreenResult`, `InjectionScreen`.
- `ToolInspection` and `ToolDefinition.inspect?` in `src/shared/tools.ts`; `approval.resolve` has an optional `how`.
- Helpers: `EventBus`, `FakeClock` / `flushPromises`, `makeTestSettings`, `StubWardenGate` (`src/main/testing/stubWarden.ts`, stays for Chip's tests), the real `createJobScheduler`, `makeSandbox` (`tests/fixtures/makeSandbox.ts`).
- Archie code (`src/main/agents/beaver/**`, `src/main/runtime/agentRuntime.ts`): read-only for you; the integration lane wires Warden into it later.

**Rules:**
- Every module takes its dependencies **injected** (Clock, bus, jobs, presence, realpath/exists, classifier, tool registry). No `Date.now` or raw timers.
- Tests never touch real user folders: use `makeSandbox` in an OS temp dir, or pure in-memory fakes.
- Do **not** commit, push or merge. Leave changes uncommitted; the orchestrator audits and commits.
- If the spec is ambiguous or two rules contradict, **STOP and report the exact rows**. This is a security gate: a guess becomes a hole.
- Final message: files changed, test count, decisions the lane file did not cover, any STOP.
