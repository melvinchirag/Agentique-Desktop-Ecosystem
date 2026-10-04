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
