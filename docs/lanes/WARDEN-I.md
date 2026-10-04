# WARDEN-I — real security integration

User authorized OpenAI parallel implementation and independent OpenAI reviews instead of unavailable Opus on October 4. Start: 12:13:42 UTC; 20-minute target, not permission to omit acceptance checks.

Approved clarification pack: transfer/invite uses the sharing/buying W1 line; retain first-match deny rule and additionally emit W9 loop alerts; tainted 37-file undo reports W6 under section 3 priority; W15 is queue behavior with no gate verdict.

Read WARDEN-COMMON, security spec sections 2/5/6/11/12/16, and the latest merged Archie runtime. Never merge into main, touch Chanuth's pending local merge, use live services, edit credentials, or test personal folders.

## Exclusive implementation split

- Core writer: `src/main/wolf/index.ts`, `src/main/chipCore.ts` (security wiring only).
- Runtime/tools writer: `src/main/runtime/agentRuntime.ts`, `src/main/agents/beaver/readTools.ts`, `src/main/agents/beaver/organizeTools.ts` (gate/screen/inspection hooks only).
- Scenario writer: `tests/scenarios/warden/**`, additive real-Warden parameterization in `tests/scenarios/helpers.ts`, `tests/scenarios/archie/helpers.ts`, `tests/scenarios/archie/integration.test.ts`, and dedicated `scripts/warden-fixture.ts` (offline fixture demo).
- Reviewer: read-only, separate OpenAI model; no implementer writes during final review.

## Required behavior

1. Create real gate, approvals, screen, speaker with injected dependencies and dispose them. Wire presence on asks/denials/alerts; hold busy while any approval is pending.
2. Runtime gates unknown tools and help-depth violations; W1 precedes W10. No gate denies non-read calls. Approvals owns all clock pauses; help titles name both animals. Screen specialist say/summary before Chip or help requester sees them; replace flagged speech with the fixed safe line.
3. Every Archie operation supplies full inspection including plan paths/count; undo inspection follows its journal. Screen extracted file text and local text before document upload. No permanent deletion or personal paths.
4. Preserve public shared contracts and existing Archie behavior. Audit arguments never include file/email bodies or secrets.
5. Add real gate/approvals/screen rigs for Chip C1-C19 and Archie A1-A20; do not count old stand-in rigs as real-Warden acceptance. Cover W1-W37 with actual assertions, including demo-only send probe and absence in normal mode.
6. Registry lint, typecheck, focused checks, full suite, fixture demo, secret/owned-path audit, independent review. Keep failed runs in report. Tiger audit joining can be fixture-tested; live persistence remains postponed.

Parent owns sequential audited lane merges X-L-J-A-G, full suite after each merge, final commits/push, and one Warden PR to main. No main merge.
