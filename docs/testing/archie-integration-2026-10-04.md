# Archie integration verification — October 4, 2026

Archie's lane I is committed as `67421d4` and merged into `beaver/logic` at `87f07d3`. This report records the orchestrator's own checks of the combined code. It does not claim live sponsor or real-Warden acceptance.

## What is implemented

- Optional real Archie wiring in `createChipCore`, with the shared specialist runtime, separate Archie client/assistant configuration, filesystem tools, and the existing runner retained for other specialists.
- Local journal as the source of truth. An optional Tiger journal receives ordered, non-blocking copies; failed copies and failed logging do not break local operations or leak provider error details.
- Talking-file artifacts, startup and six-hour trash sweeps, and shutdown handling for an active sweep and pending journal copies.
- `/sandbox` in the CLI creates temporary Desktop/Documents/Downloads fixtures, runs real filesystem tools with scripted brains and approvals, drains work before cleanup, and identifies itself as offline.
- Integration scenarios cover A1–A20, including restart undo, soft trash, decline, executable/path rejection, parallel help work, and expired-trash sweeping. Document indexing and model responses use fakes in these scenarios.

## Verification performed by the orchestrator

| Check | Result and evidence |
| --- | --- |
| Baseline before integration | `beaver/logic` at `831d4c7`: TypeScript passed; 598 tests passed, 1 skipped, across 65 files. |
| First lane full-suite run | 623 passed, 1 failed, 1 skipped. A14 expected an older document-call recording shape after its helper was strengthened. The assertion was corrected to require an upload followed by indexing with a 60-second timeout. |
| Focused final Archie tests | `npm.cmd test -- tests/scenarios/archie/integration.test.ts tests/scenarios/archie/compositeJournal.test.ts`: 26 passed across 2 files. |
| Full lane suite after A14 fix | 624 passed, 1 skipped, across 67 files. |
| Final integration TypeScript | `npm.cmd run typecheck` on `beaver/logic` at `87f07d3`: passed. |
| Final integration full suite | `npm.cmd test` on `beaver/logic` at `87f07d3`: 624 passed, 1 skipped, across 67 files. |
| Offline CLI fixture smoke | Piped `/sandbox`, `clean up my Downloads`, `/quit` into `npx.cmd tsx scripts/chip-cli.ts`. Saw one 61-file plan, one approval, 61 successful moves into 9 folders, Archie result, and Chip summary. Exit 0. |
| Fixture cleanup | The exact temporary parent printed by the CLI was absent after exit. No real Desktop/Documents/Downloads was used. |
| Diff audit | Lane changes stayed within the widened ARCHIE-I owned paths. `git diff --check` passed. No shared-contract edits were introduced by lane I. |
| Secret audit | Scanned all changed and new lane files. No real credentials found. Synthetic credential-shaped test strings were replaced with plain synthetic provider-error markers while preserving the no-leak assertions. No environment or certificate files were staged. |

Two focused/CLI launches initially failed before executing because Windows sandboxing blocked esbuild process spawning (`spawn EPERM`). The same commands passed with the required process permission. Those startup failures are not recorded as functional passes.

The six managed agents exhausted their usage allowance before returning final reviews. The orchestrator read their retained changes, fixed the A14 assertion and synthetic scan markers, and independently ran the checks above. The unfinished agent reviews are not claimed as completed.

## Remaining integration boundaries

- Melvin postponed sponsor verification. This pass did not rerun live Backboard document Q&A, Tiger persistence, or ElevenLabs audio. Earlier sponsor checks are separate evidence and do not establish Archie's live acceptance.
- The fixture gate and approval service are explicit test stand-ins. Real Warden gate, approval queue, and injection screening are a separate postponed integration; A16 verifies wrapped data with a scripted brain, not a real-model injection defense.
- App/renderer integration and merging the PR into `main` belong to the integration owner. This work does not merge into `main`.

The result is tested Archie logic and fixture integration ready for review, with the above live/security boundaries stated rather than hidden.
