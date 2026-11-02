# ADE Testing Protocol

Every result is either **passed**, **failed**, or **blocked**. A test is never described as passed because the command ran; it passes only when its stated behavior and evidence both match the specification.

## Before any test

1. Record the branch, commit, and test target. Fetch the intended remote branch before an integration test.
2. Check the working tree. Do not test over unrelated changes or secrets.
3. Read the applicable spec and lane acceptance tests. `docs/DECISIONS.md` wins when documents disagree.
4. State prerequisites before running anything: dependencies, migrations, credential names, fixture data, and any service or account ownership requirement.
5. Never print, commit, or paste `.env` contents, connection strings, certificates, or API keys into output, diffs, issues, or PR comments.

## Test layers and required order

1. **Static checks:** run TypeScript typechecking for changed TypeScript.
2. **Unit and scenario checks:** run the relevant targeted tests, then `npm test` after a lane merge or integration change.
3. **Boundary checks:** verify owned paths only, no shared-contract edits outside their approved contract PR, and no test touches a real user folder.
4. **Live services:** `npx tsx scripts/backboard-verify.ts ready` when Backboard is the brain; the Setup screen's detector checks the CLI brains. Tiger is gone: history, nudges, plans and research live in `ade.db`, covered by `src/main/store/*.test.ts`.
5. **Live behavior:** run the real CLI or app after its own required checks pass. Record the real and fake components explicitly: Chip orchestration can be verified while voice is blocked, but that is not a pass for voice. Use the smallest specified sequence first, then the full scenario.

## Credentials and live services

- Use only ignored local `.env` files. Confirm with `git check-ignore -v .env` before adding values.
- Backboard assistant IDs and ElevenLabs voice IDs must belong to the same accounts as their API keys.
- Tiger is optional since v0.2 (history is local in `ade.db`). If you test it, it needs both `TIGER_DATABASE_URL` and a readable `TIGER_CA_FILE`; do not disable TLS verification.
- If any credential, model selection, certificate, or external service is unavailable, mark the live test **blocked** and name the missing prerequisite. Do not infer a pass from offline tests.

## Chip live acceptance: C1–C3

- **C1, small talk:** Chip calls `report_user_mood`, returns a normal spoken answer, and starts no specialist job.
- **C2, email:** Chip acknowledges, starts the fake Pixel/workspace job, remains silent for the immediate tool-loop response, then speaks a summary after the fake job result.
- **C3, parallel jobs:** Chip starts Scout for the first request, then starts Pixel immediately when the email request arrives while Scout is still running; both results return without one blocking the other.
- Preserve the timestamped CLI event log as evidence. A foggy fallback, an `agent.status(error)`, missing handoff, missing result turn, or serial job start is a failure.

Run the repeatable live check from the repo root in PowerShell:

```powershell
npm.cmd run typecheck
npm.cmd test
npx.cmd tsx scripts/chip-cli.ts --live --verify-live
```

The live check uses the supplied Chip assistant with `google/gemini-2.5-flash`. It creates a fresh conversation, sends synthetic test requests, uses the real clock, and disables background nudges for this check. User turns retain the production `Auto` memory setting; these synthetic conversations can therefore affect assistant memory. It never reads a real inbox or performs a web search: Pixel and Scout are fake specialists. CLI speech events are not an ElevenLabs audio test.

For C3, the campus is explicitly named so the test does not depend on an unknown location. Fake Scout is held busy until Pixel starts. The verifier checks that Pixel was never queued, Scout is still running when Pixel starts, Scout was not delegated twice, both jobs finish, and each original request gets its own Chip result summary. The process exits nonzero if an assertion fails. `/scenario C1` through `/scenario C19` remain offline even when the CLI was started with `--live`; they never establish a live pass.

After fixing intermittent model behavior, repeat the live sequence in a fresh process and keep failed runs in the report. A later pass does not erase a failure or guarantee every future model response. If the runtime used its one bounded recovery for an unanswered turn, record that separately from a direct first-attempt success.

## Archie safety acceptance

- Every filesystem test uses `makeSandbox()` and a temporary fixture. Never use a real Desktop, Documents, Downloads, or any personal path.
- Assert sandbox escape rejection, symlink escape rejection, excluded-folder behavior, and no permanent deletion.
- Before merging an Archie lane, grep tests for real user paths and reject any non-fixture access.
- Live Archie tests run only against the fixture sandbox, with the exact allowed roots printed as non-sensitive paths.

## Reporting and stop rules

For each run, report: branch and commit, command, expected behavior, observed behavior, result, and next action. Keep a short lane table after lane work.

Stop and investigate when a live call returns an error, output differs from the expected event sequence, a credential belongs to the wrong account, a migration or certificate is missing, a test would reach real user data, a diff includes secrets, or a spec conflicts with the code. Fix the smallest confirmed cause, rerun the failed check and its affected regression tests, then report the original and final results.
