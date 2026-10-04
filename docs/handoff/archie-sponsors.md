# Archie sponsor kit — handoff to Melvin

Branch: `beaver/sponsors`. Part 1 (voice, sounds, verification) is already on `main` (PR #9). This is part 2: lanes T1 and B1, built against the contracts from PRs #11 and #12. Nothing under `src/shared` or `types.ts` is changed.

## 1. Get it
```
git fetch && git switch beaver/logic && git merge origin/beaver/sponsors
npx tsx scripts/tiger-migrate.ts        # adds file_ops.swept; safe to repeat
```

## 2. `fs_ask_file`: swap the fake for the real DocumentsApi
```ts
import { BackboardDocuments } from './src/main/sponsors/backboardDocuments';
const documents = new BackboardDocuments({ apiKey: env.BACKBOARD_API_KEY! });
// const { documentId } = await documents.uploadToThread(ctx.threadId, absPath);
// const { status, chunks } = await documents.waitIndexed(documentId, 60_000);
```
- `uploadToThread` **throws**: `UNSUPPORTED_TYPE: …` (extension not in `SUPPORTED_EXTENSIONS`), `TOO_LARGE: …` (over 20 MB), or a `BackboardError` (status + body). Both checks happen before anything is sent.
- `waitIndexed` **never throws**: `{ status: 'indexed', chunks }`, or `{ status: 'error', chunks: 0 }` for a failed document, a timeout, or a network failure. It polls once a second and waits at most 60 s whatever `timeoutMs` says.
- Indexing took 4 to 15 s for small PDFs. After `indexed`, a message on the **same thread** is answered from the file.
- Answers come from retrieved chunks, not the whole file, so "find this one exact line" can miss.
- The file goes to the job thread only. Each job needs its own thread (`ToolContext.threadId`).

## 3. The journal: composite (local first, then Tiger)
```ts
import { TigerFileOpsJournal } from './src/main/store/tigerFileOps';
const tigerJournal = new TigerFileOpsJournal(pool);        // pool = createTigerPool(env, root)
// composite.record(op): await local.record(op); void tigerJournal.record(op);
```
- Implements `FileOpsJournal` exactly. **Never throws**: a failed write is logged and dropped; a failed read returns `[]` or `null`. So a `null` from `lastBatch()` can mean "nothing to undo" or "Tiger is down": the local journal stays the source of truth.
- `lastBatch()` skips batches that are undone, swept, or made of `sweep` ops.
- `trashBatchesOlderThan(days)` returns `trash` batches that are not undone and not swept, whose newest op is older than the cutoff.
- Ids (`id`, `jobId`, `batchId`) are stored as text, so they do not have to be UUIDs.
- Ops recorded in the same millisecond are stored 1 microsecond apart, so `batchOps` returns them in the order they were recorded.
- `biome_history('agent_activity')`: Archie's row now has `file_ops` (the count since the cutoff). Other animals' rows are unchanged.

## 4. Smoke test
```
npx tsx scripts/archie-smoke.ts
```
Expected: two `PASS` lines (upload `tests/fixtures/syllabus.pdf` → indexed → answers the late-work question from the file; record 3 moves → read back by batch → marked undone).

## 5. Notes
- Archie's memory rules (`src/main/agents/beaver/memory-rules.ts`) match spec §7 word for word.
- Backboard's own maximum file size is still not verified; the 20 MB cap is the spec's.
- The schema file on this branch already has Warden's newer `wolf_audit` view (same text as `warden/sponsors`), because the shared database already had it and the older definition could no longer be applied over it.
