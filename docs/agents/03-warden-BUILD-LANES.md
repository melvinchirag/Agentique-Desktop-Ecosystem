# Warden — Parallel Build Plan for Melvin (logic)

**Builds:** `03-warden-security.md`: the real **WardenGate** (rules W0–W16), **Approvals**, **InjectionScreen**, Warden's **lines table**, and the swap that **replaces Chip's `StubWardenGate`**.
**Branch:** `wolf/logic`, **created from `chip/logic`** (needs Chip's JobScheduler + fakes). The integration lane merges `beaver/logic` (it needs Archie's AgentRuntime). Lanes: `lane/wolf-logic-<x>`. PR `wolf/logic → main` after `chip/logic` and `beaver/logic`. See `../GIT-WORKFLOW.md`.
**Method:** Hydra flow plan: Opus orchestrator; Codex GPT-6 Sol for the fragile core (high effort + Opus review); Claude Sonnet for line copy; Codex Luna / AGY Gemini 3.8 Flash High only for value-floor lanes (fixtures); no MCP for implementers.
**When:**
- **Wave 0–1:** any time after Chip's Wave 1 is merged. The rule engine, approvals, and injection screen are pure modules, so they can run **while Archie's lanes run**.
- **Integration (lane I):** after Archie's lane **R (AgentRuntime)** is merged into `beaver/logic`.

**Status:** ⏳ PENDING APPROVAL. **Target:** ≈ 2 h of lanes + 30 min integration.

---

## 1. Waves

```
WAVE 0  (Opus, ~15 min)
  - contracts: Warden's additions (spec §15): RuleId, GateRequest, GateDecision, WardenGate, Approvals,
    ApprovalOutcome, InjectionScreen, ScreenResult, ToolInspection + ToolDefinition.inspect,
    approval.request/resolve/wolf.alert fields, AdeApi getWardenRecent/getWardenToday, settings.warden.
    → If contracts/shared is STILL OPEN: fold these into it (one PR). Otherwise: PR contracts/warden → main.
    Tell Shafeen when merged.
  - wolf/logic from chip/logic (rebased on main); lane files docs/lanes/WARDEN-<X>.md; worktrees
WAVE 1  (parallel, ~60–75 min)
  X  Fixtures: injection corpus + benign set + rule matrix JSON ... Codex GPT-6 Luna medium (floor value)
  L  Lines table + bubbles + throttle (spec §7) .................. Claude Sonnet 5.5  high  (floor strong, writing)
  J  InjectionScreen layer 1 + layer-2 hook (fake classifier) .... Codex GPT-6 Sol    high  (floor strong)
  A  Approvals (queue W15, timeout, cancel, pause/resume hooks) .. Codex GPT-6 Sol    high  (floor strong)
  G  Rule engine W0–W16 + WardenGate + per-job loop/taint state .. Codex GPT-6 Sol    high  (floor strong)
     merge order: X → L → J → A → G   (Opus reviews J, A, G)
WAVE 2  (~30–40 min; needs beaver/logic lane R merged)
  I  Integration: real gate replaces the stub in createChipCore; AgentRuntime calls gate → approvals →
     execute; screenUntrusted wired into Archie's read tools; summary screening before Chip's result turns;
     inspect-card data (getWardenRecent/Today); chip-cli /scenario W-demo + Chip C-tests + Archie A-tests
     with the real gate ............................ Claude Sonnet 5.5 high  (+ orchestrator live run)
```

**Subscription load:**
- **Claude:** orchestrator, L, then I
- **Codex:** X, J, A, G
- **AGY:** none needed (X can move to AGY Gemini 3.8 Flash High if Codex is busy)

---

## 2. Lane table

| Lane | Builds (spec §) | Engine / model / effort | Floor | Backup | Owned paths | Est. |
|---|---|---|---|---|---|---|
| **X** | Fixtures (§16): `injection/` (forward-all email, malicious notes.txt, zero-width hidden text, `</untrusted>` breakout, base64 blob, hidden-HTML email, exfil image link), `benign/` (innocent "ignore/forward/password" texts), `rule-matrix.json` (≈ 60 tool calls → expected `{verdict, rule}` for W1–W16) | Codex · GPT-6 Luna · medium | value | AGY Gemini 3.8 Flash High | `tests/fixtures/warden/**` | 35 min |
| **L** | Lines table (§7): trigger → `{ text, bubble, sfx, clip }` for every rule/outcome; 10 s repeat throttle; `[serious]` tag left to the voice layer; exported list for Shafeen's pre-generation | Claude · Sonnet 5.5 · high | strong | Codex GPT-6 Sol medium | `src/main/wolf/lines.ts`, `tests/warden-lines.test.ts` | 30 min |
| **J** | InjectionScreen (§6): normalize (zero-width, tag chars, breakout escape) → weighted heuristics → score → flagged/borderline → optional `classifier` (injected; fake in tests) with 3 s timeout + fail-safe → `wrapped` output → `wolf.alert` + taint callback | Codex · GPT-6 Sol · **high** | strong | Claude Opus 5.5 medium | `src/main/wolf/injection.ts`, `tests/warden-injection.test.ts` | 60 min |
| **A** | Approvals (§5): `request` (emits `approval.request`, waits), `resolve`, `cancelForJobs`, `pending`; 5-min timeout on the injected Clock; W15 queue (1 card/job, ≤ 3 on screen, FIFO); calls `jobs.pauseClock/resumeClock` (injected); declined-on-restart rule | Codex · GPT-6 Sol · **high** | strong | Claude Opus 5.5 medium | `src/main/wolf/approvals.ts`, `tests/warden-approvals.test.ts` | 50 min |
| **G** | Rule engine (§3, §4): pure `evaluate(req, ctx)` for W0–W16 with ordering (deny > ask > allow); independent W5 path check (realpath, case-insensitive, separator boundary; injected `fs.realpath`); W7/W12 extension + scheme lists; W9 loop + W16 taint state per job; `WardenGate` class wiring it with `noteDenied/taint/endJob`; fail-closed W0 | Codex · GPT-6 Sol · **high** | strong | Claude Opus 5.5 medium | `src/main/wolf/rules.ts`, `src/main/wolf/gate.ts`, `tests/warden-rules.test.ts` | 60 min |
| **I** | Integration (see Wave 2) | Claude · Sonnet 5.5 · high | strong | Codex GPT-6 Sol medium | `src/main/chipCore.ts` (gate wiring only), `src/main/runtime/agentRuntime.ts` (gate/approval/screen calls only), `src/main/agents/beaver/*` (`inspect` + `screenUntrusted` wiring only), `tests/scenarios/warden/*` | 35 min |

**Notes for lanes:**
- Every module takes its dependencies **injected** (Clock, jobs pause/resume, bus emit, realpath, classifier) so tests run under plain Node with the fake clock.
- **Tests never touch real user folders**: W5 tests use `makeSandbox()` from Archie's lane F (or a temp dir).
- Lane I edits Archie/runtime files **only at the marked hook points**; it must not change Archie's behavior beyond adding `inspect` and the screen call.

---

## 3. Lane specs (what each `docs/lanes/WARDEN-<X>.md` says)

### X: Fixtures (Codex GPT-6 Luna medium)
- **Read:** spec §6.2, §16, §3.
- **Build:** the corpus files and `rule-matrix.json` with rows `{ agentId, tool, risk, args, inspect, jobKind, tainted, expect: { verdict, rule } }` covering every rule incl. edge cases (W5 `Downloads2` trick, W6 exactly 25 vs 26, W12 `javascript:` and `.exe` URL, W14 help+destructive).
- **Done when:** the JSON validates and each rule has ≥ 3 rows.

### L: Lines (Claude Sonnet 5.5 high)
- **Read:** spec §1, §7, §9.
- **Build:** `WARDEN_LINES: Record<Trigger, { text, bubble, sfx?, clip }>`; `lineFor(decision | outcome | alert)`; throttle (same line ≤ once per 10 s); export `allWardenLines()` for Shafeen's pre-generation script.
- **Tests:** every RuleId with a deny/ask path has a line; throttle works on the fake clock.

### J: InjectionScreen (Codex GPT-6 Sol high)
- **Read:** spec §6, §13.
- **Build:** see lane table.
- **Tests:** W-21 (corpus: malicious ≥ 0.6, benign < 0.3), W-22 (breakout), classifier fallback on timeout, alert + taint callback fired once per job.
- **STOP if:** the benign false-positive set can't stay under 0.3 without missing malicious fixtures. Report the conflicting fixtures.

### A: Approvals (Codex GPT-6 Sol high)
- **Read:** spec §5; Chip spec §4.1 (pause/resume), §9 step 1 (stop cancels approvals).
- **Tests:** W-18 timeout, W-19 cancel, W-20 pause/resume, W15 queue (4 requests across 2 jobs → correct order, ≤ 3 visible), resolve of an unknown callId is ignored.

### G: Rule engine + gate (Codex GPT-6 Sol high)
- **Read:** spec §3, §4, §12.
- **Tests:** W-1…W-17 from `rule-matrix.json`, W-26 fail-closed, W-27 speed.
- **Review:** Opus reads the diff (security-critical).

### I: Integration (Claude Sonnet 5.5 high)
- **Build:**
  1. `createChipCore`: `StubWardenGate` → `WardenGate` (+ `Approvals`, `InjectionScreen`).
  2. AgentRuntime: on `ask` → pauseClock → `Approvals.request` → resumeClock; on deny → `noteDenied`; `endJob` on finish.
  3. Archie: add `inspect` to every tool, replace the pass-through `screenUntrusted` with the real screen.
  4. Screen specialist summaries before Chip's `[job_results]`.
  5. `getWardenRecent/Today` from the bus ring (in-memory) until Shafeen's Tiger queries land.
- **Done when:** W-23, W-24, **W-25 (Chip C-tests + Archie A10–A13, A20 green with the real gate)** pass offline, and the demo scenarios in spec §14 run in chip-cli.

---

## 4. Audit + merge (orchestrator)
1. Re-run each lane's tests yourself.
2. Grep tests for real user paths (reject).
3. `git diff --stat wolf/logic...lane/wolf-logic-<x>`: owned paths only, no secrets.
4. Merge into `wolf/logic`: **X → L → J → A → G**, then (after `beaver/logic` has lane R) `git merge origin/beaver/logic` → **I**. Run `npm test` after each, then push.
5. **Cross-vendor review:** J, A, G (Codex) reviewed by Opus before merge.
6. **Escalation:** one effort notch up → backup column → fix the spec.

## 5. Timeline (from Warden start)
| Clock | Milestone |
|---|---|
| +0:15 | Contracts PR open (or folded into `contracts/shared`); X, L, J, A, G dispatched |
| +1:20 | Wave 1 merged (J, A, G reviewed) |
| +1:20 → | Wait for Archie lane R if not merged yet |
| +2:00 | **Warden done**: real gate in `createChipCore`, W-1…W-27 green, Chip + Archie suites green with the real gate |
