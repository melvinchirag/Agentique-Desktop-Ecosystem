# ARCHIE-T — Read tools

**Engine:** Codex GPT-6 Luna, high. **Branch:** `lane/beaver-logic-t`.

## Objective

Implement Archie’s read-only file tools and their safe error behavior.

## Owned paths

- `src/main/agents/beaver/readTools.ts`
- `tests/beaver-read.test.ts`

## Read

- `docs/agents/02-archie-files.md` §§4.1, 6, 11, 16
- `docs/lanes/README.md`

## Build and test

1. Implement list, search, info, plain-text read, describe, ask-file, open, and reveal tools.
2. Inject filesystem shell, index, `DocumentsApi`, and untrusted-content screening; wrap read text in `<untrusted>`.
3. Enforce executable blocking in the executor and use a fake document API until B1 lands.
4. Cover A2, A3, A4, A11, A12, A14, and A16 against the fixture.

## STOP

Stop if `DocumentsApi` or `ToolContext.threadId` is unavailable; do not change contracts.

## Orchestrator clarifications (Oct 4, after F + P + D + R merged)
- **Engine actually used:** Claude Sonnet 5.5 high (Codex's Windows sandbox can't write files, and Codex's usage limit was hit). Same lane scope.
- **Already on your branch, use it:** `safePath`/`isExcludedPath` and `FileIndex` (`src/main/connectors/fs/`), `LocalFileOpsJournal`, `tests/fixtures/makeSandbox.ts`, Archie's schemas `BEAVER_SCHEMAS`/`BEAVER_RISKS` and `BeaverBindings` (`src/main/agents/beaver/`), `DocumentsApi` + `InjectionScreen` (`src/main/runtime/types.ts`), and the new shared `FsShell` (`src/main/connectors/fs/fsShell.ts`) with `FakeFsShell` (`src/main/testing/fakeFsShell.ts`). The real `DocumentsApi` is in `src/main/sponsors/backboardDocuments.ts`; tests use a fake.
- **Shape:** export `createReadToolBindings(deps): BeaverBindings` for exactly these 8 tools: `fs_list, fs_search, fs_info, fs_read_text, fs_describe, fs_ask_file, fs_open, fs_reveal`. `deps` = `{ safe: SafePathOptions, index: FileIndex, shell: FsShell, documents?: DocumentsApi, screen?: InjectionScreen, clock?: Clock }`. Do not touch the write tools (lane O owns them) or `index.ts`.
- **Untrusted text:** every returned file text goes through `screen.screen(text, { kind: 'file', name })` when `screen` is given and returns its `.wrapped`; with no `screen`, wrap it yourself as `<untrusted source="file:NAME">…</untrusted>`.
- **`fs_open`:** the executor itself refuses executables and scripts (`.exe .bat .cmd .ps1 .vbs .js .msi .lnk .scr`), whatever Warden does later. `FsShell` is the only way to open or reveal anything.
- **No real folders, ever.** Every test builds `makeSandbox(<os temp dir>)` and removes it afterwards.
- **Do not commit, push or merge.** Leave changes uncommitted; the orchestrator audits and commits.
