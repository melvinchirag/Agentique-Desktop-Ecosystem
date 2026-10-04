# Warden — Parallel Build Plan for Melvin (logic)

**Builds:** `03-warden-security.md`: the real **WardenGate** (rules W0–W16), **Approvals**, **InjectionScreen**, Warden's **lines + speaker**, and the swap that **replaces Chip's `StubWardenGate`**.
**Branch:** `warden/logic`, **created from `chip/logic`** (needs Chip's JobScheduler, FakeClock, fakes, `StubWardenGate`, `createChipCore`) and rebased on `main` once `contracts/warden` is merged. The integration lane merges `origin/beaver/logic` (Archie's AgentRuntime; Archie keeps his `beaver/*` branch names). Lanes: `lane/warden-logic-<x>`, worktrees `../ade-wt-warden-logic-<x>`. PR `warden/logic → main` **after** `chip/logic` and `beaver/logic`. See `../GIT-WORKFLOW.md`.
**Method:** Hydra flow plan (`C:\Chanuth\hydra\models.json`): Opus 5.5 orchestrator (high; contracts design at xhigh); Codex GPT-6 Sol for the fragile core (strong floor, high effort, **Opus reviews**); Claude Sonnet 5.5 for line copy + integration; Codex GPT-6 Luna for value-floor fixtures; **AGY only as a value-floor backup, never on a strong-floor lane**; no MCP for implementers.
**When:**
- **Wave 0:** any time after Chip's Wave 1 is merged into `chip/logic` (it is). X and L need no new types and start at once.
- **Wave 1 (J, A, G):** after `contracts/warden` is merged into `main` (they code against `WardenGate`, `Approvals`, `InjectionScreen`).
- **Wave 2 (I):** after Archie's lane **R (AgentRuntime)** is merged into `beaver/logic`.

**Status:** ⏳ PENDING APPROVAL. **Target:** ≈ 2 h of lanes from start (incl. waiting for the contracts merge) + 40 min integration.

---

## 1. Waves

```
WAVE 0  (Opus, ~20 min)
  - contracts/warden → main (spec §15, EXACTLY): types.ts += WardenVerdict, GateRequest, WardenGate (+ explain?),
    ApprovalHow, ApprovalOutcome, ApprovalRequest, Approvals, ScreenSource, ScreenResult, InjectionScreen;
    tools.ts += ToolInspection + ToolDefinition.inspect?; events.ts approval.resolve += how? (optional).
    contracts/shared is already merged (PR #5), so this is its own small PR. If contracts/archie is open at the
    same time, whichever merges second rebases (both touch tools.ts/types.ts). Tell Chanuth (approves) and Shafeen.
    Ask Chanuth to merge it BEFORE Archie's lane R starts, so R codes against WardenGate/Approvals directly.
  - warden/logic from chip/logic; lane files docs/lanes/WARDEN-<X>.md; worktrees
WAVE 1  (parallel, ~60–75 min)
  X  Fixtures: injection corpus + benign set + rule matrix JSON ... Codex GPT-6 Luna medium (floor value)   ← starts in Wave 0
  L  Lines table + WardenSpeaker + throttle (spec §7) ............ Claude Sonnet 5.5  high  (floor strong)   ← starts in Wave 0
  J  InjectionScreen layer 1 + layer-2 hook (fake classifier) .... Codex GPT-6 Sol    high  (floor strong)   ← after contracts
  A  Approvals (W15 queue, ref-counted pause, timeout, abort) .... Codex GPT-6 Sol    high  (floor strong)   ← after contracts
  G  Rule engine W0–W16 + WardenGate + arg scan + per-job state .. Codex GPT-6 Sol    high  (floor strong)   ← after contracts
     rebase warden/logic on main after contracts merge; merge order: X → L → J → A → G   (Opus reviews X's matrix, J, A, G)
WAVE 2  (~40 min; needs beaver/logic lane R merged)
  I  Integration (§3 I) ................................. Claude Sonnet 5.5 high  (Opus reviews; + orchestrator live run)
```

**Subscription load:**
- **Claude:** orchestrator, L, then I
- **Codex:** X, J, A, G
- **AGY:** none planned (backup for X only)

---

## 2. Lane table

| Lane | Builds (spec §) | Engine / model / effort | Floor | Backup | Owned paths | Est. |
|---|---|---|---|---|---|---|
| **X** | Fixtures (§16): `injection/` (forward-all email, malicious notes.txt, zero-width hidden text, `</untrusted>` breakout, base64 blob, hidden-HTML email, exfil image link, instruction-giving calendar title, instruction-giving specialist summary), `benign/` (innocent "ignore/forward/password" texts), `rule-matrix.json` (≈ 70 tool calls → expected `{verdict, rule}`, ≥ 3 rows per rule W0–W16) | Codex · GPT-6 Luna · medium | value | AGY Gemini 3.8 Flash High | `tests/fixtures/warden/**` | 35 min |
| **L** | Lines (§7): `WARDEN_LINES` trigger → `{ text, bubble, priority, sfx?, clip }` (priorities exactly as §7: warden vs report); `lineFor(decision \| outcome \| alert)`; 10 s throttle on the injected Clock; `allWardenLines()` for Shafeen's pre-generation; `WardenSpeaker` (subscribes to `wolf.verdict`, `approval.resolve`, `wolf.alert`; emits `agent.say` from `'wolf'`; silent on allow) | Claude · Sonnet 5.5 · high | strong | Codex GPT-6 Sol medium | `src/main/wolf/lines.ts`, `src/main/wolf/speaker.ts`, `tests/warden-lines.test.ts` | 30 min |
| **J** | InjectionScreen (§6) `implements InjectionScreen`: normalize (zero-width, tag chars, breakout escape) → weighted heuristics → score → flagged/borderline → optional injected `classifier` (fake in tests) with 3 s timeout + fail-safe → `wrapped` → `wolf.alert` (once per task + source) + injected `onFlag(taskId)` (taint callback) | Codex · GPT-6 Sol · **high** | strong | Claude Opus 5.5 medium | `src/main/wolf/injection.ts`, `tests/warden-injection.test.ts` | 60 min |
| **A** | Approvals (§5) `implements Approvals`: `request` (emits `approval.request {callId,title,preview}` + `agent.status waiting_approval` for the asker, waits), `resolve`, `cancelForJobs`, `pending`, `dispose`; abort via `signal`; 5-min timeout on the injected Clock (starts when visible); W15 queue (1 visible card per job, ≤ 3 on screen, FIFO); **ref-counted** `jobs.pauseClock/resumeClock`, also pausing the asking job of a help job (`jobs.list()`); emits `approval.resolve {callId, approved, how}`; reports declines to the gate (for W9) through an injected callback | Codex · GPT-6 Sol · **high** | strong | Claude Opus 5.5 medium | `src/main/wolf/approvals.ts`, `tests/warden-approvals.test.ts` | 50 min |
| **G** | Rule engine (§3, §4): pure `evaluate(req, ctx)` W0–W16 in the §3 order; generic arg scan + `inspect` merge; independent W5 (Archie §2 relative-path resolution, injected `realpath`/`exists`, case-insensitive, separator boundary, §2.5 exclusions, ADE Trash write rule); W1 segment match; W7/W12 lists; effective-risk max; per-job W9 state, per-task W16 taint; `WardenGate implements WardenGate` (`review` sync, emits `wolf.verdict` from `'wolf'`, `explain(callId)`, `taint(taskId)`, `noteDeclined(jobId, callKey)`, clears per-job state on `job.update` done/failed/cancelled via the bus); W0 fail-closed wrapper | Codex · GPT-6 Sol · **high** | strong | Claude Opus 5.5 medium | `src/main/wolf/rules.ts`, `src/main/wolf/inspect.ts`, `src/main/wolf/gate.ts`, `tests/warden-rules.test.ts`, `tests/warden-gate.test.ts` | 60 min |
| **I** | Integration (§3 I) | Claude · Sonnet 5.5 · high | strong | Codex GPT-6 Sol medium | `src/main/wolf/index.ts` (`createWarden()` + presence wiring), `src/main/chipCore.ts` (Warden wiring only), `src/main/runtime/agentRuntime.ts` (marked hook points only), `src/main/agents/beaver/readTools.ts` + `organizeTools.ts` (`inspect` + screen calls only), `tests/scenarios/warden/**` | 40 min |

**No overlap with other plans:** Chip owns `src/main/runtime/{jobs,presence,mood,nudges,history}.ts`, `src/main/agents/chipmunk/**`, `src/main/testing/**`; Archie owns `agentRuntime.ts`, `src/main/connectors/fs/**`, `src/main/agents/beaver/**`; the app shell owns `src/renderer/**`, `src/main/fake/**`, `src/main/ipc/**`, `src/main/shell/**`. Warden's only edits outside `src/main/wolf/**` and its tests are lane I's marked hook points, done **after** those owners have merged (sequential, so no conflicts). `StubWardenGate` stays in `src/main/testing/` for Chip's tests.

**Notes for lanes:**
- Every module takes its dependencies **injected** (Clock, jobs, bus, presence, realpath/exists, classifier, tool registry) so tests run under plain Node with the fake clock.
- **Tests never touch real user folders**: W5 tests use `makeSandbox()` from Archie's lane F (or a temp dir).
- Lane I edits Archie/runtime files **only at the marked hook points**; it must not change Archie's behavior beyond adding `inspect`, the screen calls, and the gate/approvals wiring.

---

## 3. Lane specs (what each `docs/lanes/WARDEN-<X>.md` says)

### X: Fixtures (Codex GPT-6 Luna medium)
- **Read:** spec §3, §6.2, §16.
- **Build:** the corpus files and `rule-matrix.json` with rows `{ agentId, tool, risk, args, inspect, jobKind, tainted, priorDenied, priorDeclined, expect: { verdict, rule } }` covering every rule incl. edge cases (W5 `Downloads2` trick, `.git` path, move into ADE Trash; W6 exactly 25 vs 26; W11 37-file undo vs tainted undo; W12 `javascript:` and `.exe` URL; W14 help + destructive; W10 `ask_teammate` in a help job; W1 `fs_propose_plan` must **not** match).
- **Done when:** the JSON validates and each rule has ≥ 3 rows. **The orchestrator (Opus) checks every expected verdict against spec §3 before merge**: the matrix is G's test oracle.

### L: Lines + speaker (Claude Sonnet 5.5 high)
- **Read:** spec §1, §7, §9; Chip spec §4.4.
- **Tests:** every RuleId with a deny/ask path has a line; priorities match §7; throttle on the fake clock; allow emits nothing; speaker emits `agent.say` with `agentId:'wolf'`.

### J: InjectionScreen (Codex GPT-6 Sol high)
- **Read:** spec §6, §13.
- **Tests:** W-21 (corpus: malicious ≥ 0.6, benign < 0.3), W-22 (breakout), classifier fallback on timeout/error, alert + taint callback once per task + source, flagged result `say` replacement helper.
- **STOP if:** the benign false-positive set can't stay under 0.3 without missing malicious fixtures. Report the conflicting fixtures.

### A: Approvals (Codex GPT-6 Sol high)
- **Read:** spec §5; Chip spec §3 (help jobs), §4.1 (pause/resume), §9 step 1 (stop cancels approvals); `JobScheduler` in `types.ts` + `jobs.ts` on `chip/logic` (boolean pause).
- **Tests:** W-18 timeout, W-19 abort → cancelled, W-20 4-min approval doesn't time out the job (real `JobScheduler` + FakeClock), W-29 two asks in one job (clock stays paused until both settle), W-30 help job pauses both jobs, W15 queue (4 requests across 2 jobs → correct order, ≤ 3 visible), unknown/settled `callId` ignored, `dispose()` declines all.

### G: Rule engine + gate (Codex GPT-6 Sol high)
- **Read:** spec §3, §4, §12, §15; Archie spec §2, §4, §13; `StubWardenGate` on `chip/logic`.
- **Tests:** W-1…W-17 from `rule-matrix.json`, W-26 fail-closed, W-27 speed, W-33, W-34, W-35, `StubWardenGate` assignable to `WardenGate` (type test).
- **Review:** Opus reads the diff (security-critical).

### I: Integration (Claude Sonnet 5.5 high)
- **Read:** spec §2, §5, §6, §11, §12; Archie spec §14; the merged `agentRuntime.ts`.
- **Build:**
  1. `createWarden({ bus, clock, jobs, presence, settings, registry, classifier? })` → `{ gate, approvals, screen, speaker }`; `createChipCore`: `StubWardenGate` → `createWarden()` (one line plus the deps).
  2. AgentRuntime hook points: `gate.review({ agentId, taskId, callId, tool, risk, jobId, jobKind, args })`; on `deny` → output `{error:'DENIED_BY_WOLF', ...gate.explain(callId)}` + `tool.result(ok:false)`; on `ask` → `approvals.request({..., signal: ctx.signal})` (**remove any direct `pauseClock/resumeClock` calls**: Approvals owns them); no gate wired → deny non-read; screen `say` + `summary` before returning the `AgentResult` (covers Chip's result turn and `ask_teammate` output); `ask_teammate` on help jobs goes to the gate (W10).
  3. Archie: `inspect` on every write/destructive tool (and `fs_open`), `screenUntrusted` → `screen.screen(text, {kind:'file', ...}).wrapped`; `fs_ask_file` local pre-screen (§6).
  4. Presence: on ask/deny/alert → `presence.wake('wolf','job')` if not active; `setBusy('wolf', approvals.pending().length > 0)`.
  5. IPC: none. The app shell's `CoreAdapter` already maps `resolveApproval` → `approvals.resolve`.
- **Review:** Opus reads the diff (it is the moment security becomes real).
- **Done when:** `npm test` on `warden/logic` is fully green: **W-1…W-36**, **all Chip tests** (C1–C19 scenarios + unit suites), and **all Archie tests** (A1–A20) running with the **real** gate, Approvals, and screen; the §14 demo scenarios run in `chip-cli` against the fixture sandbox.

---

## 4. Audit + merge (orchestrator)
1. Re-run each lane's tests yourself.
2. Grep tests for real user paths (reject).
3. `git diff --stat warden/logic...lane/warden-logic-<x>`: owned paths only, no secrets.
4. Merge into `warden/logic`: **X → L → J → A → G**, then (after `beaver/logic` has lane R) `git merge origin/beaver/logic` → **I**. Run `npm test` after each, then push.
5. **Cross-vendor review:** X's matrix, J, A, G (Codex) and I (Sonnet) reviewed by Opus before merge.
6. **Escalation (Hydra rule: effort before band):** one effort notch up on the same model (e.g. Sol high → xhigh; Luna medium → high) → the backup column at its default effort → fix the spec. Never move a strong-floor lane to AGY.
7. When Shafeen posts "Warden sponsor kit ready", `git merge origin/warden/sponsors` (owned paths don't overlap) and switch the classifier from the fake to `wardenClassifier`.

## 5. Timeline (from Warden start)
| Clock | Milestone |
|---|---|
| +0:20 | `contracts/warden` PR open; X and L dispatched |
| +0:20 → +0:50 | Chanuth reviews + merges the contracts PR; rebase `warden/logic`; dispatch J, A, G |
| +1:00 | X, L merged |
| +2:00 | J, A, G merged (Opus-reviewed) |
| +2:00 → | Wait for Archie lane R if not merged yet (Archie's plan: R lands ≈ +1:20 from Archie start) |
| +2:40 | **Warden done**: real gate in `createChipCore`, W-1…W-36 + Chip + Archie suites green |

---

## 6. Handoffs to other plans (after approval; not Warden-owned paths)
- **App shell (Chanuth's Codex):** Warden inspect-card variant (spec §8: `getPulse().warden`, `getWardenAudit(10)`, pending approvals, "Open Audit tab", no "What I remember"); Audit tab filters (client-side) + the new `asking_agent`/`tool` columns; ApprovalCard: 5-min countdown from the event `ts` + rule chip from the matching `wolf.verdict`; the director finds the asking animal via `tool.request.callId`; Warden sits by the oldest visible card; `FakeCore` scripts `approval`/`warden-block` use the real fields (+ optional `how`) and canned `pulse.warden`.
- **Archie lanes:** if `contracts/warden` is merged before lanes T/O, they add `inspect` themselves and lane R codes against `WardenGate`/`Approvals` (no direct pause/resume); otherwise Warden's lane I does it at the hook points.
- **Pixel / Scout / Swarm plans:** call `screen.screen()` on emails, calendar text, and fetched pages; give every write/destructive tool a `preview` and `inspect`; no tool name may contain a W1 segment.
