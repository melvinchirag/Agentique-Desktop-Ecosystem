# ARCHIE-SP-W1 — Verification for Archie
**Branch:** `lane/beaver-sponsors-w1` · **Spec:** `docs/agents/02-archie-files.md` §4.1, §6 · **Engine:** Claude (orchestrator runs it)

## Objective
Facts lane B1 and the voice layer need before they are built.

## Owned paths
`docs/sponsor-verify.md` (append only)

## Steps
1. Backboard thread documents: `POST /threads/{thread_id}/documents` (multipart `file`) and `GET /documents/{document_id}/status`. Record the real response shapes, status values, index time for a multi-page PDF, and whether a question is answered from the file.
2. Limits: maximum size and supported types, from vendor docs or the API's own error messages. Mark anything not confirmed as "not verified".
3. ElevenLabs: does `eleven_v4_turbo` accept `[softly]` without reading it aloud? If not, name the nearest tag that works.

## Done when
Each item has an answer with evidence, or "not verified" with the reason.

## STOP if
A check would upload real personal files or spend more than a trivial amount of credits.

## Rules
Owned paths only. Never print or commit keys or `.env`. Use a made-up fixture file. Delete throwaway assistants afterwards. Do not push.
