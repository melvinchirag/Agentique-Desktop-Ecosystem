# Chip live delegation fix and verification

Tested locally on October 4, 2026, on `chip/logic`, based on commit `fbdc48a` with the uncommitted changes described below. This report concerns Chip's live orchestration, not the completion of every ADE agent or the desktop application.

## What was wrong

The live CLI originally inherited `openai/test-model` from offline settings. The earlier fix selects the sponsor-verified `google/gemini-2.5-flash` for live runs while retaining fake model settings offline.

With a valid model, Chip could still describe a handoff without calling `delegate`, or report the user's mood and return `(silent)` without starting any work. The job scheduler's offline tests did not expose this because they script the model's tool calls. The live model decides which tools to call, so a separate live test is necessary.

The manual parallel test also used fake specialists that finish after three seconds. Real model latency can exceed that window. A reliable concurrency test must keep Scout busy long enough to submit the independent email request.

## What changed

1. Chip's prompt explicitly requires a tool call for a clear specialist request. It asks for mood reporting first and delegation next in the same tool-call response, explains that speaking a promise does not start work, and requires a new independent request to be delegated while another animal is busy. Necessary clarification remains allowed.
2. The orchestrator detects a silent or empty user-turn response when no action was attempted. It permits one corrective model turn, on the same conversation and with memory `Readonly`. The correction omits the mood tool so the model cannot spend that turn reporting mood again. If the correction still produces no answer or delegation, Chip gives an explicit failure message.
3. Recovery is not attempted after an action has already been attempted. This prevents the recovery mechanism from reissuing actions that could already have had side effects. A successful delegation still receives its normal acknowledgement and waits for the specialist result.
4. `chip-cli --live --verify-live` runs repeatable C1-C3 checks with assertions and a nonzero exit status on failure. It prints response statuses and tool names without printing credentials or memory contents. Fake Scout is held until Pixel starts; the scheduler and Chip's decisions remain real code.

## Test setup and procedure

The run used the existing Chip Backboard assistant and its local ignored credentials. Each invocation created a fresh conversation. Chip used real Backboard calls and a real clock. Pixel and Scout returned synthetic results. Background nudges were disabled during the acceptance sequence. User turns retained `Auto` memory, so these synthetic conversations can affect the assistant's memory.

Commands:

```powershell
npm.cmd test
npm.cmd run typecheck
npx.cmd tsx scripts/chip-cli.ts --live --verify-live
```

C1 sends a greeting and checks for a mood event, Chip speech, and no jobs. C2 requests today's email, then checks the fake Pixel delegation, acknowledgement, specialist report, and later Chip summary. C3 explicitly names the University of Michigan-Dearborn campus, starts a pizza search, and requests email while Scout is held busy. It checks that Pixel starts without being queued, Scout remains running, no duplicate Scout job is created, both jobs complete, and each request receives a Chip summary.

The campus is named to avoid conflating an unknown-location clarification with a delegation failure. The verifier never calls a specialist directly to manufacture a job: Chip must call `delegate` itself.

## Failed attempts retained

- Prompt strengthening alone still produced a mood-only silent response to C2 in one fresh run. A subsequent traced run passed, confirming that one pass was insufficient evidence of reliability.
- An initial recovery that retained the mood tool failed C3: the model repeated mood reporting on its corrective turn. The runtime returned an explicit failure, and the verifier exited with failure. This led to removing the mood tool from the corrective turn.
- The local log `chip-live-verification-1.log` records that failed intermediate C3 run. It is ignored by Git.

## Final results

| Check | Result | Evidence |
|---|---|---|
| Offline regression | Passed | 34 files, 284 tests |
| TypeScript | Passed | `tsc --noEmit` |
| Diff whitespace | Passed | `git diff --check` |
| Final live run 1 | C1, C2, C3 passed | Scout started at +23.0 s; Pixel at +29.4 s while Scout remained running; both results summarized by +37.8 s |
| Final live run 2, fresh conversation | C1, C2, C3 passed | Scout started at +25.0 s; Pixel at +31.1 s while Scout remained running; both results summarized by +39.6 s |

The two final live runs delegated successfully on their first attempts; neither needed recovery. Their ignored local event logs are `chip-live-verification-2.log` and `chip-live-verification-3.log`. Unit tests separately exercise recovery after a mood-only silent reply, bounded failure on silent and empty responses, and prevention of retries after an attempted action. Existing tests cover ordinary delegation, clarification, cancellation, chains, and result turns.

## Limits and remaining work

This establishes two consecutive live C1-C3 passes on the final patch. It does not guarantee perfect behavior for every model response or every future request. A text-only promise without a tool call is discouraged by the prompt but is not automatically classified by the recovery logic; the new recovery specifically covers silent and empty responses before any action attempt.

CLI `agent.say` events establish speech intent, not audible ElevenLabs output. Real email access and real web research were not exercised because the specialists were fake. ElevenLabs still needs a usable secret key, and Tiger still needs the CA certificate before their previously failing checks can be rerun. Those services were not retested in this fix. The desktop overlay and Archie integration are separate acceptance work.

Changes remain local and uncommitted. No branch switch, commit, push, or PR action was performed for this fix. Shared contracts and credentials were not modified. All test processes have exited.

Repeat the same live command after integration, and follow `TESTING.md` for evidence, prerequisite checks, and honest pass/fail/blocked reporting.

## Re-verification with the tightened checks (Claude Sonnet 5.5 session, Oct 4, ~06:00)

Branch `chip/logic`, starting from `ea61a77`; Backboard live, Pixel and Scout fake, nudges disabled. A read-only audit had shown the original C1–C3 checks could pass wrongly, so they were tightened before this re-run. The earlier "two passes" above were produced by the looser checks and should be read with that in mind.

| Run | Result | What it showed |
|---|---|---|
| 4 | **FAIL C1** | The model's first reply to a greeting had no tool call and no text. The corrective turn rescued the answer but removes the mood tool, so the mood was only the engine's fallback ("no mood reported"). A skipped mood read would give an angry user no reaction from the biome. |
| 5 | **FAIL C1** | After the fix below, the mood tool *was* called (`calm 0.2 (greeting)`), yet C1 failed: the check looked for a `tool.request` event, which Chip's own tools never emit. That assertion could never pass. A verifier bug, not a Chip bug. |
| 6 | PASS C1, C2, C3 | Real mood call each turn; real `delegate` calls; Pixel started while Scout was still running. |
| 7 | PASS C1, C2, C3 | Same, in a fresh conversation. |

Fixes made:
1. The corrective turn keeps `report_user_mood` when mood has not yet been reported, and says so; it still drops it when mood was already reported (the earlier C3 failure was a model repeating the mood tool instead of acting). New unit test covers it.
2. The C1 check now requires a `user.mood` event that is not the orchestrator's synthesized fallback (reasons `no mood reported` / `voice cue …`).

Extra probe (not part of C1–C3): a live message in capitals ("THIS IS SO ANNOYING NOTHING WORKS!!") produced `user.mood angry 0.9` from the model, then Chip scared, Pixel nervous, Warden protective, Archie scared, Scout nervous in spec order (§15), and a calm spoken reply.

Offline: 34 files, 286 tests; TypeScript clean. Event logs: `chip-live-verification-4.log` … `-7.log` (git-ignored).

Still not covered: real Pixel/Scout, audible voice, Tiger persistence, desktop overlay. Runs 6 and 7 are two passes on one prompt; they do not guarantee every future model reply, which is why the corrective turn and the explicit failure line exist.
