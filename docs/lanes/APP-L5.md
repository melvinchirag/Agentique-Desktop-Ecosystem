# Lane L5 — Agent Hub window UI (AGY Gemini 3.8 Flash High, interactive)

Read `docs/lanes/APP-COMMON.md` first. **Deny every MCP tool prompt.** Do not launch the app unless
Chanuth tells you to.

## Objective
The Agent Hub: the only app-like UI. A small (360×560, collapsible to 360×56) frameless window, top-right,
dragged by its header. Chat, status rows, tray, tabs, settings, onboarding, and a static Marketplace panel.

## Owned paths
- `src/renderer/hub/**` (replace Wave 0's placeholder `HubApp.tsx`; keep `main.tsx` mounting it)

## Spec to read
`00-APP-SHELL-SPEC.md` §4 (focus model), §9, §11, §13; `DECISIONS.md` §6, §9 (Memory screen, Pulse, Audit).
Contracts: `HubAppProps`, `HubAppComponent`, `HubStoreHook`, `HubState`, `AgentRow`, `TrayItem`,
`TranscriptLine`, `PendingApproval` in `src/renderer/shell/contracts.ts`; `AdeShellApi`, `HubTab` in
`src/main/shell/contracts.ts`; `AdeApi`, `AdeSettings` in `src/shared/ipc.ts`; `AGENTS` in
`src/shared/config.ts`. Render with `demoSeedState()` from `src/renderer/shell/seed.ts` in tests.

## Data you read (canned by the fake core today; real later — render defensively)
- `api.getPulse()` → `{ moodWeek: { day, mood, score }[]; jobsPerAgent: Partial<Record<AgentId, number>>;
  wardenBlocks: number; wardenAsks: number }`
- `api.getWardenAudit(50)` → newest-first `{ ts, taskId?, agentId, tool, verdict: 'allow'|'ask'|'deny',
  rule, reason }[]`
If a field is missing or the call rejects, show an empty state instead of crashing.

## Steps (plain React + CSS; no new dependencies; CSS files or CSS modules inside `src/renderer/hub/`)
1. **`HubApp.tsx`** exports `HubApp: HubAppComponent` (props `store`, `api`, `shell`). `main.tsx` keeps
   creating the store, loading `api.getSettings()` into it, wiring `api.onEvent(store.getState().applyEvent)`,
   and mounting `HubApp` with `window.ade` / `window.adeShell`.
2. **Header** (`-webkit-app-region: drag`; every button `no-drag`): ADE logo + title (click → Marketplace
   panel), user-mood chip (`userMood`), **Agents ▾** (lists `docked` animals → `api.wakeAgent(id)`),
   **DND** toggle (`api.setDoNotDisturb` + `store.setDnd`), **Hide animals** toggle (`shell.hideAnimals` +
   `store.setAnimalsHidden`; also follow `onDemoHotkey('hideAnimals')` and `onLayoutChanged` →
   `animalsHidden`), ⚙ Settings, collapse (`shell.setHubCollapsed`; collapsed = header only, 56 px).
3. **Status rows** (always visible under the header, compact): avatar (color dot + initial from `AGENTS`),
   name, presence badge (active / asleep / docked; hide `not_installed`), job title + a running mm:ss timer
   from `job.since` (one shared 1 s interval, only while some job is running), queued count, pending-approval
   badge. Click a row → `shell.inspectAgent(id)`.
4. **Tray**: `tray` items; `email_draft` with `openUrl` → "Open in Gmail" (`window.open(openUrl)`); others
   → "Copy" (`navigator.clipboard.writeText` of the title + a text rendering of `data`).
5. **Tabs**:
   - **Chat**: transcript (user right-aligned; animals left with their name; recall lines with 💭; alerts
     styled as warnings), text box (Enter sends: `api.sendMessage(text, 'text')`, clear, then
     `shell.blurHub()`), and a **hold-to-talk mic button** (pointerdown → start a `MediaRecorder` on
     `getUserMedia({ audio: true })`; pointerup → stop → `api.sendVoice(bytes, mime)`; ≤ 30 s; keep this
     self-contained in `src/renderer/hub/mic.ts`).
   - **Memories**: animal picker (core animals except Warden, whose memory is off — show a note) →
     `getMemories`; search box → `searchMemories`; inline edit → `updateMemory`; delete → `deleteMemory`.
     `shell.onOpenHubTab('memories', id)` opens this tab with that animal selected.
   - **Pulse**: `getPulse()` → mood-this-week bars, jobs per animal bars, Warden blocks/asks counts.
     Simple divs, no chart library.
   - **Audit**: `getWardenAudit(50)` rows (time, animal, tool, verdict chip, rule, reason) with a
     **Replay** button on rows that have a `taskId` → `shell.replayTask(taskId)` (see note below).
6. **Settings** panel: model per animal (select from a fake list: openai gpt-4o / gpt-4o-mini, anthropic
   claude-sonnet-4-20250514, google gemini-2.5-pro → `api.setSettings({ models })`); voices on/off
   (`voiceEnabled`); allowed folders (list with add/remove text entries); timers display + **Demo mode**
   toggle (`demoMode`); **Connect Google** (`api.connectGoogle()` → show the email); **Asset Lab** button
   (`shell.openAssetLab()`). Reflect `store.settings`.
7. **Onboarding** (first run; `localStorage` key `ade.onboarded`, wrapped in try/catch): 1) pick your AI
   (sets every animal's model), 2) connect Google (skippable), 3) voices on/off, 4) "Pixel is learning how
   you write" (shown disabled: "coming soon"). Finish → set the flag.
8. **Marketplace panel** (static): cards for all 8 animals (installed / wake), community agents
   (placeholder), skins, biomes (forest ✓, desert and snow "coming soon"), "Verified by Warden" badge.
9. **Focus**: `Esc` anywhere → `shell.blurHub()`; `shell.onFocusChat` → switch to Chat and focus the text box.
   Unsubscribe every `on*` listener on unmount.
10. Look: dark, rounded, readable at 360 px wide, subtle shadows, each animal's accent color from `AGENTS`.

> **Note:** `shell.replayTask(taskId)` is added to `AdeShellApi` by the orchestrator before this lane starts.
> If it is missing from `src/main/shell/contracts.ts` when you start, STOP and tell Chanuth.

## Tests you must add (`// @vitest-environment jsdom`, @testing-library/react, mocks from
`src/renderer/shell/mocks.ts`, store seeded with `demoSeedState()`)
Rows render from the seed; row click → `inspectAgent`; Enter sends + blurs; Esc blurs; DND toggle calls the
api; Agents ▾ wakes a docked animal; Memories delete calls `deleteMemory`; Audit Replay calls `replayTask`;
Pulse renders with an empty object without crashing; onboarding shows once.

## Manual checks for Chanuth after merge
§16 item 4 (drag the Hub by its header, type, Esc returns focus), collapse/expand, every tab.

## Lane-specific STOP conditions
- Something you need isn't in `HubAppProps`, `AdeApi`, or `AdeShellApi`.
