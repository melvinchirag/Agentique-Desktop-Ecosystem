# BACKBOARD-V1: finish and verify Backboard for every animal

**Engine:** Claude Sonnet 5.5 high. **Branch:** `backboard/verify` (from `main`). **Read first:** `docs/TESTING.md`, `docs/lanes/README.md`, `docs/sponsor-verify.md`, `docs/SPONSORS.md` Part 2.

## Why
Backboard is proven for **Chip only** (live C1–C3 pass). Everything else is unverified: the other animals' assistants, Scout's web search, Archie's "ask a file", and whether users can bring their own provider key.

## Rules (from `docs/TESTING.md`)
- Each result is **passed / failed / blocked**, with expected vs observed. A pass needs real evidence from a live call.
- **Never print, log, write or commit a key, connection string or `.env` content.** You can't read `.env`: your process already has the needed variables. Assistant and voice **IDs** are identifiers, not secrets, but still prefer saying "set" / "missing".
- **Never use `--force`** on `create-assistants.ts` (it deletes memories). Use `memory: 'off'` on every test call so Chip's and the animals' memories are not polluted.
- On the first 401/403, **stop** and report it (wrong account or key). Never loop on a failing call. Budget: at most about 40 API calls in total.
- Use only synthetic test content. Never touch real files or folders.

## Owned paths (only these)
- `scripts/backboard-verify.ts` (new, repeatable, redacts everything)
- `docs/backboard-verification.md` (new, the report)

You may *run* existing scripts (`create-assistants.ts`, `archie-smoke.ts`, `sponsor-smoke.ts`) but must **not edit any other file**. If a bug is in `src/`, report it; don't fix it.

## Tasks
1. **Inventory.** Write `scripts/backboard-verify.ts` with a first step that lists which `BB_ASSISTANT_<AGENT>` and `EL_VOICE_<AGENT>` variables are set or missing (names only), plus `BB_ASSISTANT_WARDEN_SCREEN` if `src/main/sponsors/wardenClassifier.ts` defines that variable name.
2. **Create the missing assistants:** run `npx tsx scripts/create-assistants.ts` (no flags). It is idempotent. Note that it writes the new IDs to a `.env` in this worktree; say in the report exactly which variable names it wrote so the orchestrator can copy them to the main `.env`.
3. **Prove every assistant works.** For each assistant that now exists: one `BackboardClient.send` with `memory: 'off'`, no tools, model `{ llm_provider: 'google', model_name: 'gemini-2.5-flash' }`, content "Reply with the single word READY." PASS = status `COMPLETED` and non-empty content. Also confirm the key and each assistant belong to the same account (a mismatch shows as 401/404).
4. **Scout web search.** Send to the `eagle` assistant with `webSearch: 'Auto'`, `memory: 'off'`: "In one sentence: what is the capital of Michigan? Name the source." PASS = completed, answer mentions Lansing. Record whether the response carries source/citation data (describe the shape, never paste long text).
5. **Archie "ask a file".** Run `npx tsx scripts/archie-smoke.ts`. Its Tiger checks are **expected to fail** (the Tiger password is missing): report those as *blocked*, not failed. Report only the Backboard "Ask a file" result on its own.
6. **Open question B5 (bring your own provider key).** Read Backboard's docs (`https://backboard-docs.docsalot.dev/llms.txt` and pages it links). Report what the docs say about users supplying their own provider API keys, with the URL. Mark *not verified live* if you cannot test it without another provider's key.
7. **Report.** Write `docs/backboard-verification.md`: a table per task with expected, observed, result, next action; then a short "what is still not done" list and who owns each item. No secrets.

## Done means
`npx tsc --noEmit` clean, `npm test` green, the report written, nothing committed. Final message: pass/fail/blocked per task, the variable names written to the worktree `.env`, anything surprising.

## STOP
401/403, a script that tries to write outside `.env`, or any need to edit `src/`. Report and wait.
