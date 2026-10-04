# PIXEL-SP-PW1 — Verification
**Branch:** `pixel/sponsors` · **Plan:** `docs/agents/04-pixel-SPONSOR-LANES-SHAFEEN.md` · **Spec:** `docs/agents/04-pixel-workspace.md` §5.2, §6.4, §10, §11
**Engine:** Claude Opus (the orchestrator built it; Codex and AGY were not used)

## Objective
Memory poisoning, style-learning call, thread deletion, style memory round trip, PDF and .docx thread documents, drafts_log unique key.

## Owned paths
docs/sponsor-verify.md (append)

## Done when
The lane's tests pass, Chip's, Archie's, and Warden's sponsor tests still pass (`npm test`), and `npx tsx scripts/pixel-smoke.ts` passes.

## Rules
Never edit `src/shared` or `types.ts`. No keys or connection strings in commits. No text from a real mailbox in any committed file or fixture.
