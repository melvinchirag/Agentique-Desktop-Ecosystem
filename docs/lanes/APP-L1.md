# Lane L1 — Windows, click-through, focus, shell IPC (Codex GPT-6 Sol, high)

Read `docs/lanes/APP-COMMON.md` first.

## Objective
The main-process shell: the overlay, Hub, and Asset Lab windows; display/work-area/DPI handling; the
`OverlayController` (forward + poll pointer modes); every `window.adeShell` channel; Hub drag/collapse/focus/
Esc-blur; mic permissions; demo/dev `globalShortcut`s; single instance; hide animals. Plus the renderer-side
`HitRegistry` that decides when the overlay is interactive.

## Owned paths
- `src/main/index.ts`
- `src/main/shell/**` **except** `src/main/shell/contracts.ts` (frozen)
- `src/preload/**`
- `src/renderer/shell/hitRegistry.ts`, `src/renderer/shell/hitRegistry.test.ts`

## Spec to read
`00-APP-SHELL-SPEC.md` §2, §3, §4, §5 (ground line / DPI rows only), §11, §13, §15 (single instance), §16
items 1–4 and 12, §17, §18; the "X0 results" section at the top. Reference (approved spike, read-only):
`C:\Chanuth\Eastern Michigan University\Hackathons\HackDearborn2026\ade-wt-app-x0\spikes\x0-overlay\main.js`.

## Steps
1. **`src/main/shell/display.ts`**: primary display only. `readDisplay()` → work area, bounds, scaleFactor.
   Pure helpers (tested): `hubBoundsFor(workArea, collapsed, current?)` (default top-right, 16 px margin,
   360×560 or 360×56; a dragged Hub keeps its position but is clamped inside the work area),
   `buildDisplayLayout(...)` → `DisplayLayout`. Watch `display-metrics-changed`, `display-added`,
   `display-removed` → overlay `setBounds(workArea)`, clamp the Hub, broadcast `SHELL_IPC.layoutChanged`.
2. **`src/main/shell/overlayWindow.ts`**: `createOverlayWindow(opts)` → `{ window, controller: OverlayController }`
   with the spec §2 options exactly (`focusable: false`, transparent, `backgroundColor: '#00000000'`,
   `skipTaskbar`, no frame/shadow/thickFrame, not resizable, `setAlwaysOnTop(true, 'floating')`,
   `setIgnoreMouseEvents(true, { forward: true })`, `sandbox: true`, `contextIsolation: true`,
   `backgroundThrottling: false`). Fallbacks behind flags: `--level screen-saver`, `--toolbar`
   (`type: 'toolbar'`), `--pointer poll` (or env `ADE_POINTER=poll`): poll `screen.getCursorScreenPoint()`
   every 33 ms, convert to overlay-local, hit-test against the shapes from `publishHitShapes` (pure
   `pointInAny(rects, point)`, tested), apply the 60 ms leave debounce. `setHidden(true)` → `hide()`;
   `false` → `showInactive()` + re-assert always-on-top (never steal focus). `setInteractive` is a no-op
   when unchanged.
3. **`src/main/shell/hubWindow.ts`**: frameless, focusable, always-on-top (`floating`), `skipTaskbar`, not
   resizable, `transparent: false`, 360×560 top-right. `setCollapsed(c)` → 360×56 (keep top-right corner).
   `focusChat()` → `show()`, `focus()`, push `SHELL_IPC.hubFocusChat`. `blur()` → `hub.blur()`.
   On `moved`/`resize`, broadcast the new layout (debounced ~50 ms) so the dock point follows the Hub.
   Closing the Hub quits the app. DevTools: dev mode only, detached, Hub only (spec §17).
4. **`src/main/shell/assetLabWindow.ts`**: a regular window (≈1100×750, framed, focusable), loads
   `assetlab.html`; opening it again focuses the existing one.
5. **`src/main/shell/permissions.ts`**: `setPermissionRequestHandler` + `setPermissionCheckHandler` allow
   `media` only for our overlay/Hub webContents with our own origin (dev server URL or `file://` app pages);
   deny everything else. `setWindowOpenHandler` on every window: `https:` URLs →
   `shell.openExternal`, everything else denied (the Hub tray's "Open in Gmail" uses `window.open`).
   Block in-window navigation away from our pages (`will-navigate`).
6. **`src/main/shell/demoShortcuts.ts`**: register **Ctrl+Shift+N** (→ `core.demoFireNudge()` and push
   `SHELL_IPC.demoHotkey` `'nudge'`), **Ctrl+Shift+A** (open Asset Lab; push `'assetLab'`), **Ctrl+Shift+H**
   (toggle hide animals; push `'hideAnimals'`) **only while demo mode or dev mode is on**; unregister when
   both are off and on `will-quit`. Pure `shouldRegister(demoMode, devMode)` tested. Demo mode comes from
   the core's settings: wrap the adapter (`src/main/shell/settingsWatch.ts`:
   `watchSettings(adapter, onChange): CoreAdapter`, which re-reads `getSettings()` after every
   `setSettings` and at start) so main reacts when the Hub toggles demo mode; on every change push
   `SHELL_IPC.settingsChanged` (the full `AdeSettings`) to every window and re-broadcast the layout (its
   `demoMode` flag).
7. **`src/main/shell/shellIpc.ts`**: register every `SHELL_IPC` channel. Overlay-only channels
   (`setInteractive`, `publishHitShapes`) and Hub-only channels (`blurHub`, `setHubCollapsed`) ignore other
   senders. Validate payloads with pure, tested validators: booleans, rect arrays (finite numbers, ≤ 64
   rects), `AgentId` ∈ `AGENTS`, `HubTab` ∈ the union. Relays: `hubFocusChat` → Hub; `openHubTab` → Hub
   (+ focus it); `inspectAgent` → overlay; `hideAnimals` → controller + layout broadcast;
   `openAssetLab` → asset lab window; `replayTask` (Hub → main; string taskId ≤ 200 chars) → push to the
   overlay. Return a disposer.
8. **`src/main/index.ts`**: single-instance lock (a second launch focuses the Hub); `devMode =
   !app.isPackaged || argv includes --dev`; optional `--no-gpu` → `app.disableHardwareAcceleration()`
   (fallback only; default on); create the windows; permissions; shell IPC; then exactly one line chooses
   the core, marked for Lane J2:
   `const core = watchSettings(createFakeCore({ demoMode, resourcesDir }), onSettings); // J2: swap createFakeCore → createRealCore`
   `registerCoreIpc(core, { ipc: ipcMain, targets })` where targets = live overlay + Hub (+ Asset Lab if
   open) webContents. Call `core.start?.()` once the overlay and Hub both fired `did-finish-load`. Clean up
   on `before-quit` (timers, shortcuts, `core.dispose?.()`). `resourcesDir` = `process.resourcesPath` when
   packaged, else `<repo>/resources`.
9. **`src/preload/index.ts`**: keep Wave 0's `window.ade`; make `window.adeShell` complete and correct
   against the contract (every `on*` returns an unsubscribe that removes only its own listener).
10. **`src/renderer/shell/hitRegistry.ts`**: `createHitRegistry: CreateHitRegistry` exactly per the contract:
    shapes map; `hitTest` priority (bubble/card/banner over animal; last-set wins among equals);
    `pointerMove` → `sink.setInteractive` only on change, false debounced `leaveDebounceMs` (60);
    `setCaptured(true)` forces interactive until released (then re-evaluates the last pointer position);
    `publishHitShapes` throttled to `publishHz` (10) and only when shapes changed; `dispose` clears timers.
    Uses the injected `Clock` (default real timers).

## Tests you must add (vitest, no real Electron)
Hit registry (priority, debounce with a fake clock, only-on-change, capture, throttle, dispose); display math
at 100/125/150 % (work areas 1920×1040 @1, 1536×816 @1.25, 1280×680 @1.5) incl. Hub clamping after a work-area
shrink; poll hit-test; payload validators; `shouldRegister`; `watchSettings` (calls through, fires on change).
Mock `electron` with `vi.mock('electron', ...)` only where unavoidable.

## Manual checks for Chanuth after merge (list them in your final message)
§16 items 1 (no taskbar button; Alt-Tab noted), 2 (click-through, 10 spots), 3 (hover an animal → clickable),
4 (Hub drag/type/Esc; overlay never steals focus), 12 (DPI 100/125/150 %), Ctrl+Shift+H/A/N in demo mode only.

## Lane-specific STOP conditions
- `focusable: false` + forwarded mouse moves stop working together on this machine (X0 says they work).
- Any need to change `SHELL_IPC` or `AdeShellApi`.
