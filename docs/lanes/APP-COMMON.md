# App-shell Wave 1 — rules every lane follows

Read this first, then your lane file `docs/lanes/APP-<LANE>.md`.

## Where you are
- A git worktree on branch `lane/app-shell-<lane>`, branched from `app/shell` after Wave 0.
- Wave 0 already gave you: Electron + electron-vite + React 19 + three/R3F/drei + zustand + jsdom +
  @testing-library/react, the IPC wiring, a stub FakeCore, the Hub store, and test helpers.
- The **frozen interfaces** are `src/main/shell/contracts.ts`, `src/renderer/shell/contracts.ts`,
  `src/renderer/shell/env.d.ts`. You implement and consume them exactly as written.
- Helpers you may import: `src/renderer/shell/hubStore.ts` (`createHubStore`, `reduceHubEvent`,
  `initialHubState`), `src/renderer/shell/mocks.ts` (`createMockAdeApi`, `createMockShellApi`, `makeEvent`),
  `src/renderer/shell/seed.ts` (`demoSeedState`), `src/shared/*` (types, `AGENTS`, `IPC`).
- **Never import from another Wave 1 lane's folder.** Lanes run in parallel; code only against the
  contracts and mock the rest (e.g. a mock `CharacterLayer` that logs calls).

## Never touch
`src/shared/**`, `src/main/runtime/**`, `src/main/bus/**`, the three frozen contract files,
`package.json`, `package-lock.json`, `tsconfig.json`, `vitest.config.ts`, `electron.vite.config.ts`,
`electron-builder.yml`, `docs/**`, `tests/**`, and any path not in your lane's **Owned paths**.
Need a new dependency? STOP (don't install it).

## Setup
1. `npm install` (worktrees don't share `node_modules`). If already installed, `npm install` is still fine.
2. Read your lane file's spec sections in `docs/app-shell/00-APP-SHELL-SPEC.md`.

## Rules
- Tests are colocated in your owned folder as `*.test.ts` / `*.test.tsx` (vitest picks up `src/**`).
  Default environment is node; DOM tests start with `// @vitest-environment jsdom`.
- Tests must never touch real state: no real Electron, no real audio devices, no network, no files outside
  the OS temp dir. Use fake clocks (`Clock` from `src/main/runtime/types.ts`) for anything timed.
- Keep Electron-dependent code thin; put logic in pure functions/modules you can test.
- Do **not** launch Electron or any GUI window (`npm run dev`, `npm run preview`, `electron .`) unless
  Chanuth explicitly tells you to in this session. Chanuth runs the manual checks after the merge.
- No MCP tools, no web browsing, no network besides `npm install`. Never write `.env` files, keys, or tokens.
- Performance matters (Chanuth's laptop renders on the CPU): no work every frame unless something is
  visible and changing; no timers left running when idle.
- Comments only where the code isn't obvious. Match the existing style (TypeScript strict, ESM, 2 spaces,
  single quotes).

## Checks every lane MUST run before committing (all must pass)
1. `npx tsc --noEmit`
2. `npm test`
3. `npm run build`
4. `git status --porcelain` and `git diff --stat app/shell` show only your owned paths; no secrets.
Then commit once (or a few logical commits) on your lane branch:
`app(shell): <LANE> <what>` (e.g. `app(shell): L3 CharacterLayer`). Do not push. Do not open PRs.

## Common STOP conditions (stop, explain, and commit nothing broken)
- A frozen interface can't express something you need (say exactly what and why).
- A ⚠ verify behavior from the spec fails on this machine.
- Any need to touch `src/shared/*`, a frozen contract, the never-touch list, or a path you don't own.
- A dependency you'd need isn't installed.

## Final message (keep it short)
1. Files created/changed. 2. The tail of each check's output. 3. Manual checks Chanuth should do after the
merge (spec §16 numbers), if any. 4. Anything the W2a wiring lane must know (exports, props, gotchas).
5. Open questions / STOPs.
