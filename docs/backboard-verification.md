# Backboard verification (lane BACKBOARD-V1)

Run on 2026-10-04. Branch `backboard/verify`, base commit `53ff7c1`, nothing committed.
Repeatable script: `npx tsx scripts/backboard-verify.ts [inventory|ready|scout]`. It prints names, statuses and short synthetic answers only.
Every call used `memory: 'off'`, synthetic text, and `google / gemini-2.5-flash`. About 30 Backboard calls in total. No 401 or 403 appeared.
`docs/TESTING.md` and `docs/lanes/README.md` are not on this branch (they live on `chip/logic`); they were read from git history.

## Task 1. Inventory (names only)
| Expected | Observed | Result | Next action |
|---|---|---|---|
| Every `BB_ASSISTANT_<AGENT>` and `EL_VOICE_<AGENT>` set | Before: `BB_ASSISTANT_CHIPMUNK` and `EL_VOICE_CHIPMUNK` set; the other 7 assistants, `BB_ASSISTANT_WARDEN_SCREEN` and the other 7 voices missing. `BACKBOARD_API_KEY` and `ELEVENLABS_API_KEY` set | passed (inventory done) | Assistants fixed in task 2. **Voices are still missing for 7 animals**: run `scripts/design-voices.ts` (Shafeen) |

## Task 2. Create missing assistants
| Expected | Observed | Result | Next action |
|---|---|---|---|
| `npx tsx scripts/create-assistants.ts` (no flags) creates the missing ones, skips Chip | Skipped Chip. Created Pixel, Warden, Archie, Scout, Swarm, Iris, Celene and the Warden Screen assistant. No `--force`, so no memory was deleted | passed | Copy the variable names below into the main `.env` |

Variables written to this worktree's `.env` (values not shown here): `BB_ASSISTANT_WORKSPACE`, `BB_ASSISTANT_WOLF`, `BB_ASSISTANT_BEAVER`, `BB_ASSISTANT_EAGLE`, `BB_ASSISTANT_ANTS`, `BB_ASSISTANT_BUTTERFLY`, `BB_ASSISTANT_NIGHTINGALE`, `BB_ASSISTANT_WARDEN_SCREEN`.
The script wrote only to `.env`. Note that these 8 assistants now exist on the Backboard account; if the orchestrator does not copy the IDs, a later run of `create-assistants.ts` from another checkout would create duplicates.

## Task 3. Every assistant answers (`Reply with the single word READY.`)
| Assistant | Expected | Observed | Result |
|---|---|---|---|
| chipmunk | COMPLETED, non-empty | COMPLETED, "READY." | passed |
| workspace (Pixel) | same | COMPLETED, "READY" | passed |
| wolf (Warden) | same | COMPLETED, "READY" | passed |
| beaver (Archie) | same | COMPLETED, "READY" | passed |
| eagle (Scout) | same | COMPLETED, "READY." | passed |
| ants (Swarm) | same | COMPLETED, "READY" | passed |
| butterfly (Iris) | same | COMPLETED, "READY" | passed |
| nightingale (Celene) | same | COMPLETED, "READY" | passed |
| warden screen | same | COMPLETED, non-empty, but the content is a classifier JSON (`{"injection": ..., "confidence": ...}` inside a code fence), not the word READY | passed (by the lane's rule) |

Same account: all 9 calls returned 200, with no 401 or 404, so the key and every assistant belong to one account.
Surprising: the Warden Screen assistant ignores "reply READY" and runs its classifier prompt, as designed. `wardenClassifier.ts` already sends `jsonOutput`; the code fence seen here appeared without `json_output`, so a caller must parse leniently or always set `jsonOutput`. Owner: Warden lane, to confirm.
Next action: none.

## Task 4. Scout web search
| Expected | Observed | Result | Next action |
|---|---|---|---|
| `eagle`, `web_search: 'Auto'`, `memory: 'off'`: COMPLETED and the answer mentions Lansing | COMPLETED. Answer: "The capital of Michigan is Lansing, according to the Michigan State Capitol website (https://capitol.michigan.gov/...)." | passed | See the source note |

Source and citation data: **there is no structured citation field.** The response keys are `message, thread_id, assistant_id, content, system_one, message_id, role, status, tool_calls, run_id, memory_operation_id, retrieved_memories, retrieved_files, retrieved_files_count, reasoning, model_provider, model_name, input_tokens, output_tokens, total_tokens, created_at, attachments, generated_media, voice_records, timestamp, context_usage`.
`retrieved_memories` and `retrieved_files` were `null` (they refer to memory and documents, not the web). The only source was a URL written into the answer text. Scout must ask for links in its prompt and parse URLs from `content`. `BackboardClient.send` already returns `content`, so no client change is needed. A single call does not prove every search answer carries a URL.

## Task 5. Archie "ask a file" (`scripts/archie-smoke.ts`)
| Check | Expected | Observed | Result | Next action |
|---|---|---|---|---|
| Ask a file (Backboard) | Upload `syllabus.pdf` to a Archie thread, index it, answer the late-work question from the file | Indexed in 6.9 s (8 chunks). Answer: late homework costs 12% per day and is not accepted after four days | passed | none |
| File-ops journal (Tiger) | Expected to fail here | `ENOENT` for `.tiger-ca.pem` in this worktree (the Tiger CA file is missing; the Tiger password is also missing) | blocked | Shafeen: provide `TIGER_DATABASE_URL` and `TIGER_CA_FILE`, then rerun |

## Task 6. Open question B5: bring your own provider key
| Expected | Observed | Result | Next action |
|---|---|---|---|
| Docs say whether users can supply their own provider API keys | Nothing in the docs mentions it. `https://backboard-docs.docsalot.dev/llms.txt` has no page, title or description about BYOK, "bring your own", "provider key" or "custom provider". `https://backboard-docs.docsalot.dev/concepts/billing.md` only covers Backboard's own credits ("New accounts include $5 in free credits (valid for 30 days)"). `https://backboard-docs.docsalot.dev/concepts/models.md` only mentions authenticating to Backboard with `X-API-Key` | **not verified live**; docs are silent | Keep the pitch as "pick any model". Ask Backboard staff or check the dashboard before claiming BYOK (Melvin) |

Limit: only `llms.txt`, billing and models were read, and a small model summarised the pages. A page that is not in `llms.txt` could still cover it.

## What is still not done
| Item | Owner |
|---|---|
| Copy the 8 new `BB_ASSISTANT_*` IDs into the main `.env` | Orchestrator |
| ElevenLabs voices for 7 animals (`EL_VOICE_*`) | Shafeen (`scripts/design-voices.ts`) |
| Tiger checks (needs `TIGER_DATABASE_URL`, `TIGER_CA_FILE`) | Shafeen |
| BYOK (B5) answer from Backboard | Melvin |
| Scout prompt should require source links, since there is no citation field | Scout/Chip lane owner |
| Warden Screen output with and without `json_output` (code fence) | Warden lane |
| Memory behaviour of the new assistants (all tests ran with memory off) | Not tested; `docs/sponsor-verify.md` B6 covers Chip and Archie only |
| Archie ask-a-file with a large file (size limit) | Not tested (`sponsor-verify.md` A3) |

## Checks
`npx tsc --noEmit` clean. `npm test`: 9 files, 135 tests passed.

## Orchestrator re-check
Re-run independently by the orchestrator (Claude Sonnet 5.5, Oct 4): inventory shows every `BB_ASSISTANT_*` and the Warden Screen assistant set in the main `.env` (the eight new IDs were copied there from the worktree; no conflicts); `scripts/backboard-verify.ts ready` passed 9/9 (`COMPLETED`, content returned, memory off). Still open: B5 (bring-your-own provider key, docs silent), seven missing ElevenLabs voices (`design-voices.ts`, Shafeen), Tiger (password), memory behavior of the new assistants (all tests ran with memory off).
