# Archie — Parallel Build Plan for Melvin (logic + AgentRuntime)

**Builds:** `02-archie-files.md` (spec) **and** the generic **AgentRuntime** (spec §14) that every later animal reuses.
**Branch:** `beaver/logic`, **created from `chip/logic`** (Archie needs Chip's JobScheduler, fakes, and `createChipCore`). Lanes: `lane/beaver-logic-<x>`. PR `beaver/logic → main` after `chip/logic` is merged. See `../GIT-WORKFLOW.md`.
**Method:** Hydra flow plan, same as Chip: Opus orchestrator; Codex GPT-6 Sol/Luna implementers; Sonnet for writing; AGY Gemini 3.8 Flash High only for value-floor lanes; no MCP for implementers.
**When:** start once Chip's Wave 1 is merged into `chip/logic` (JobScheduler exists). Can overlap Chip's Wave 2.
**Status:** ✅ APPROVED (Oct 4). Decisions in `02-archie-files.md` header.
**Target:** Archie working against a fixture folder ≈ 2 h after start; live ≈ 2.5 h.

---

## 1. Waves

```
WAVE 0  (Opus, ~15 min)
  - follow-up contracts PR (branch contracts/archie → main), opened only AFTER Melvin's contracts/shared
    PR is merged: ArtifactKind 'file_note', ToolContext.threadId, types.ts: FileOp (op += trash|sweep),
    FileOpsJournal (+ trashBatchesOlderThan, markSwept), DocumentsApi   (spec §15)  → tell Shafeen when merged
  - beaver/logic from chip/logic (rebased on the merged contracts); lane files docs/lanes/ARCHIE-<X>.md; worktrees
WAVE 1  (parallel, ~60–75 min)
  R  AgentRuntime (generic specialist runner) ...... Codex  GPT-6 Sol   high   (floor strong)
  P  safePath + file index + watcher ............... Codex  GPT-6 Sol   medium (floor strong)
  D  Archie prompt + AgentDefinition + output text . Claude Sonnet 5.5  high   (floor strong, writing)
  F  Fixture sandbox + local FileOpsJournal ........ AGY    Gemini 3.8 Flash High (floor value)
     merge order: F → P → D → R
WAVE 2  (parallel, ~45–60 min; needs P + R merged)
  T  Read tools: list/search/info/read_text/describe/ask_file/open/reveal  Codex GPT-6 Luna high (floor value)
  O  Organize engine: plan/propose/apply/move/rename/mkdir/trash/undo      Codex GPT-6 Sol  high  (floor strong)
     merge order: T → O ; Opus reviews O (fragile file moves)
WAVE 3  (~30 min)
  I  Integration: real Archie replaces the fake beaver in createChipCore; chip-cli scenarios A1–A16
     ............................................ Claude Sonnet 5.5 high  (+ orchestrator live run)
```

**Subscription load:**
- **Claude:** orchestrator, D, then I
- **Codex:** R, P, then T, O
- **AGY:** F

---

## 2. Lane table

| Lane | Builds (spec §) | Engine / model / effort | Floor | Backup | Owned paths | Est. |
|---|---|---|---|---|---|---|
| **R** | AgentRuntime: registry, fresh thread per job, tool loop, gate + approvals with job-clock pause, `ask_teammate` injection (normal jobs only), BUBBLE/SAY/SUMMARY parser, artifact collection, retry (§14) | Codex · GPT-6 Sol · **high** | strong | Claude Opus 5.5 medium | `src/main/runtime/agentRuntime.ts`, `src/main/runtime/specialistOutput.ts`, `tests/agentRuntime.test.ts` | 60 min |
| **P** | `safePath` (§2) + file index + `fs.watch` (§3) | Codex · GPT-6 Sol · **medium** | strong | Claude Sonnet 5.5 high | `src/main/connectors/fs/safePath.ts`, `src/main/connectors/fs/fileIndex.ts`, `tests/safePath.test.ts`, `tests/fileIndex.test.ts` | 50 min |
| **D** | Archie system prompt (§8), `AgentDefinition` (`maxToolRounds: 8`), tool schemas as JSON (§4), status-detail strings (§10) | Claude · Sonnet 5.5 · **high** | strong | Codex GPT-6 Sol medium | `src/main/agents/beaver/index.ts`, `prompt.ts`, `schemas.ts`, `tests/beaver-prompt.test.ts` | 40 min |
| **F** | Fixture sandbox generator (spec §16) + local `FileOpsJournal` (jsonl, §5) | AGY · Gemini 3.8 Flash High | value | Codex GPT-6 Luna high | `tests/fixtures/makeSandbox.ts`, `src/main/connectors/fs/localJournal.ts`, `tests/localJournal.test.ts` | 45 min |
| **T** | Read tools + their executors (§4.1, §6), including the `DocumentsApi` call for `fs_ask_file` (fake until Shafeen's B1 lands) | Codex · GPT-6 Luna · **high** | value | Codex GPT-6 Sol medium | `src/main/agents/beaver/readTools.ts`, `tests/beaver-read.test.ts` | 50 min |
| **O** | Organize: strategies, plan store (30 min TTL), propose validation, apply with journal-before-op, clash naming, cross-volume copy-verify-delete, **soft trash into ADE Trash + 7-day sweep via `shell.trashItem` (injected)**, undo (§4.2, §5) | Codex · GPT-6 Sol · **high** | strong | Claude Opus 5.5 medium | `src/main/agents/beaver/organizeTools.ts`, `src/main/agents/beaver/planStore.ts`, `tests/beaver-organize.test.ts` | 60 min |
| **I** | Wire the real Archie into `createChipCore` (runtime + tools + composite journal); chip-cli `/scenario A1..A16` against the fixture; mark specs passing | Claude · Sonnet 5.5 · **high** | strong | Codex GPT-6 Sol medium | `src/main/chipCore.ts` (Archie wiring only), `tests/scenarios/archie/*` | 30 min |

**Notes for lanes:**
- **Electron-only APIs** (`shell.trashItem`, `shell.openPath`, `shell.showItemInFolder`, `app.getPath`) are **injected** as a small `FsShell` interface so everything runs under plain Node in tests. The app shell supplies the real ones at integration.
- `fs_ask_file` uses `DocumentsApi` from `types.ts`. Lane T builds against a fake; Shafeen's B1 provides the real one.
- **Tests never touch real user folders:** every test uses `makeSandbox()` in a temp dir (an orchestrator audit check).

---

## 3. Lane specs (what each `docs/lanes/ARCHIE-<X>.md` says)

### R — AgentRuntime (Codex GPT-6 Sol high)
- **Read:** Archie spec §14; Chip spec §3, §4.1, §7, §8, §16; `ARCHITECTURE §4.3`.
- **Build:** `AgentRuntime implements SpecialistRunner`:
  - registry of `AgentDefinition`s
  - memory mode per job kind
  - fresh thread per job
  - parallel tool calls per round, all outputs submitted together
  - gate → approval wait with `jobs.pauseClock/resumeClock`
  - `ask_teammate` only on normal jobs, through `jobs.submit({kind:'help'}) + waitFor`
  - output truncation to 12k
  - `specialistOutput.ts` parser (BUBBLE/SAY/SUMMARY + fallbacks)
  - artifact collection
  - one retry on Backboard failure
- **Tests (FakeLlm + fake gate + fake jobs):**
  - two tool calls in one round run in parallel and both outputs are submitted
  - a denied call returns `DENIED_BY_WOLF`
  - declined → `USER_DECLINED`
  - the clock is paused during an approval
  - a help job has no `ask_teammate`
  - parser fallbacks
  - artifacts collected
- **STOP if:** `types.ts` lacks something you need (e.g. `ToolContext.threadId` not merged yet).

### P — safePath + index (Codex GPT-6 Sol medium)
- **Read:** spec §2, §3.
- **Build:** `safePath(input, roots)` per the 5 steps; `FileIndex` (async chunked scan, caps, exclusions, watcher, `search()` ranking, `update(op)`).
- **Tests:** A1 cases; the index finds by name/ext/age; the watcher picks up a new file; exclusions are respected.

### D — Archie prompt + definition (Claude Sonnet 5.5 high)
- **Read:** spec §1, §4, §8, §10.
- **Build:** exact prompt text + the shared rules block; `AgentDefinition { id:'beaver', tools, maxToolRounds: 8 }`; tool schemas exactly as §4; status-detail strings ("Sniffing through <folder>…", "Plan: N files → M folders", "Building the dam… x/N").
- **Tests:** snapshots; every schema is valid JSON Schema; tool names are unique.

### F — Fixture + local journal (AGY Gemini 3.8 Flash High)
- **Build:**
  - `makeSandbox(tmpDir)` creates the §16 fixture: ~60 files, `.git` dir, `.exe`, a fresh file, `notes.txt`, an outside `Downloads2/secret.txt`, a symlink to outside (skip it if symlinks are not permitted on the machine, and log that)
  - `LocalJournal implements FileOpsJournal` (append-only jsonl; `lastBatch`, `batchOps`, `markUndone` and `markSwept` as appended marker rows, `trashBatchesOlderThan`). **Primary** undo store ✅
- **Tests:** the journal survives "restart" (new instance reads the file).
- **AGY note:** run interactively; deny MCP prompts.

### T — Read tools (Codex GPT-6 Luna high)
- **Read:** spec §4.1, §6, §11.
- **Build:**
  - executors for `fs_list`, `fs_search`, `fs_info`, `fs_read_text` (plain text now; pdf/docx behind a feature flag), `fs_describe`, `fs_ask_file` (DocumentsApi + 60 s wait), `fs_open` (block list), `fs_reveal`
  - `<untrusted>` wrapping through an injected `screenUntrusted()` (pass-through stub until Warden)
  - errors per §11
- **Tests:** A2, A3, A4, A11, A12, A14 (fake DocumentsApi), A16.

### O — Organize engine (Codex GPT-6 Sol high)
- **Read:** spec §4.2, §5, §11.
- **Build:**
  - `fs_plan_organize` (by_type/by_date, skip rules, clash names)
  - `fs_propose_plan` (validate every move)
  - `planStore` (30 min TTL)
  - `fs_apply_plan` (journal-before-op, progress status every 10, partial-failure report)
  - `fs_move`, `fs_rename`, `fs_mkdir` (each asks Warden, W3)
  - `fs_trash` = **soft trash** into `Documents/ADE Trash/<batchId>/…` (journaled `trash`), undoable
  - **7-day sweep** (`sweepTrash(clock)`): at start + every 6 h, batches older than 7 days → `FsShell.trashItem` → journal `sweep`, `markSwept`
  - `fs_undo` (reverse order, skip conflicts, remove empty created folders; restores trash batches; swept batch → `ALREADY_IN_RECYCLE_BIN`)
  - exclude `ADE Trash` from plans (P's index excludes it too)
  - `riskFor`/`preview` per §4 (W6 summary preview when > 25)
- **Tests:** A5, A6, A7, A8, A9, A10, A13, **A17 (trash → undo), A18 (7-day sweep, fake clock), A19, A20**.
- **Review:** Opus reads this diff before merge (fragile).

### I — Integration (Claude Sonnet 5.5 high)
- **Build:**
  - register Archie in AgentRuntime
  - `createChipCore` uses the real runtime for `beaver` (other animals stay fake)
  - composite journal (local + Tiger once Shafeen's T1 is merged; local-only until then)
  - chip-cli `/scenario A1..A16` and a `/sandbox` flag that points `allowedFolders` at the fixture
- **Done when:** A1–A16 pass offline; A2, A3, A5, A7 pass live (real Backboard) **against the fixture folder, never real folders**.

---

## 4. Audit + merge (orchestrator)
1. Re-run each lane's tests yourself.
2. **Grep tests for real paths:** any `os.homedir()`, `Desktop`, `Downloads` outside the fixture → reject.
3. `git diff --stat beaver/logic...lane/beaver-logic-<x>`: owned paths only, no secrets.
4. Merge into `beaver/logic`: **F → P → D → R**, then **T → O**, then **I**. Run `npm test` after each, then push.
5. **Cross-vendor review:** R and O (Codex) are reviewed by Opus.
6. **Escalation:** one effort notch up → backup column → fix the spec.

## 5. Timeline (from Archie start)
| Clock | Milestone |
|---|---|
| +0:15 | Follow-up contracts PR (`contracts/archie`) open; lanes R, P, D, F dispatched |
| +1:20 | Wave 1 merged |
| +2:10 | T, O merged (O reviewed) |
| +2:40 | **Archie done**: A1–A16 offline, live smoke against the fixture |
