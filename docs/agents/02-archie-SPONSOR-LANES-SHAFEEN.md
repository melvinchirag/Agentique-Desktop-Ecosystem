# Archie — Sponsor Tech Build Plan for Shafeen

**Builds:** Archie's Backboard, ElevenLabs, and Tiger pieces, **reusing the tooling from Chip's lanes S1–S6** (`01-chip-SPONSOR-LANES-SHAFEEN.md`).
**Branch:** `beaver/sponsors` from `main` (after the `contracts/archie` PR merges; until then from `chip/sponsors`). Lanes: `lane/beaver-sponsors-<x>`. PR `beaver/sponsors → main`.
**Specs:** `02-archie-files.md` §5 (journal), §4.1 (`fs_ask_file`), §7 (memory rules), §9 (voice/SFX); `../SPONSORS.md` Archie rows.
**Method:** Hydra (Opus orchestrator; Codex Sol implementers; AGY for asset scripts; Sonnet for verification). No MCP for implementers.
**When:** after Chip's sponsor kit is handed off. **Target: ≈ 1.25 h.**
**Status:** ✅ APPROVED (Oct 4). Contract additions land via Melvin's follow-up PR `contracts/archie` (after his `contracts/shared` PR).

---

## 1. Lanes

| Lane | Builds | Engine / model / effort | Floor | Backup | Owned paths | Est. |
|---|---|---|---|---|---|---|
| **B1** | **`DocumentsApi`** in the Backboard client: `uploadToThread(threadId, absPath)` → `POST /threads/{thread_id}/documents` (multipart `file`); `waitIndexed(id, timeoutMs)` → poll `GET /documents/{document_id}/status` until `indexed`/`error` (every 1 s, max 60 s). Plus confirm Archie's assistant in `create-assistants.ts` uses the **exact memory rules from spec §7**. | Codex · GPT-6 Sol · medium | strong | Claude Sonnet 5.5 high | `src/main/sponsors/backboardDocuments.ts`, `src/main/agents/beaver/memory-rules.ts`, `tests/backboardDocuments.test.ts` | 35 min |
| **V1** | **Archie's voice + sounds**: `design-voices.ts --only beaver` (description + preview line from spec §9) → the team picks → `EL_VOICE_BEAVER`; `generate-sfx.ts` adds **tail slap, wood gnaw loop, log thunk, paper rustle, reverse whoosh** (skip any S4 already made) | AGY · Gemini 3.8 Flash High | value | Codex GPT-6 Luna medium | `voices/previews/beaver-*`, `resources/sfx/beaver/**`, `resources/sfx/manifest.json` (append only) | 30 min |
| **T1** | **`TigerFileOpsJournal implements FileOpsJournal`** over the existing `file_ops` table: `record` (insert), `lastBatch` (latest non-undone `batch_id`), `batchOps`, `markUndone`, `recent(sinceHours)`, `trashBatchesOlderThan(days)`, `markSwept`; migration adds `swept BOOLEAN DEFAULT false` to `file_ops` and allows `op` = `trash`/`sweep`. This is the **copy**; the local journal stays primary. Plus the `biome_history` add-on: `agent_activity` for `beaver` includes `file_ops` counts. Never throws into the app (log + continue). | Codex · GPT-6 Sol · medium | strong | Claude Opus 5.5 medium | `src/main/store/tigerFileOps.ts`, `tests/tigerFileOps.test.ts` | 40 min |
| **W1** | **Verification:** Backboard thread-document limits (max size, supported types, typical index time for a 10-page PDF); confirm the `[softly]` audio tag for the talking-file voice (or the nearest supported tag). Append to `docs/sponsor-verify.md`. | Claude · Sonnet 5.5 · high | strong | Codex GPT-6 Sol medium | `docs/sponsor-verify.md` (append) | 20 min |

**Merge order into `beaver/sponsors`:** W1 → T1 → B1 → V1. Opus reviews T1 (persistence).

---

## 2. Handoff to Melvin
- Post **"Archie sponsor kit ready: <commit>"**.
- Melvin's lane I merges `origin/beaver/sponsors` into `beaver/logic` and switches `fs_ask_file` from the fake to the real `DocumentsApi`, and the journal from local-only to **composite** (local first, then Tiger).
- **Smoke test:** upload a fixture PDF to a fresh thread → `indexed` → ask one question; record 3 file ops → read them back by batch → mark undone.

## 3. Audit
- Same as Chip: re-run tests; owned paths only; no keys or connection strings in diffs; voice previews and SFX mp3s are fine to commit.
