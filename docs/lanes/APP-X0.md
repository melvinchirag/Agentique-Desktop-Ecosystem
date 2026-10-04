# Lane X0 — Overlay spike (THROWAWAY)

You are an implementer. Build a small, throwaway Electron spike that tests whether ADE's real-Windows-desktop overlay works on this machine. **This code is never merged into `app/shell`.** It only answers the questions below, so the real build knows which approach to use.

Background (read only if needed): `docs/app-shell/00-APP-SHELL-SPEC.md` §2–§5 and §17 on branch `docs/app-shell-plan`. Everything you need is in this file.

## Owned paths
- `spikes/x0-overlay/**`: create everything here. **Touch nothing else** in the repo (no root `package.json`, no `src/`).
- This file (`docs/lanes/APP-X0.md`) is read-only.

## Stack
- `spikes/x0-overlay/package.json`: its own package (`"private": true`), Electron (latest stable), `three`, `@react-three/fiber`, `react`, `react-dom`, plus `esbuild` (or `vite`) to bundle the renderer. Keep it minimal.
- Scripts: `npm run build` (bundles the renderer) and `npm start` (builds, then launches Electron). Also `npm run start:nogpu`, which launches with `app.disableHardwareAcceleration()` (controlled by a `--no-gpu` argument or an env var).
- TypeScript or plain JS, whichever is fastest. No tests framework needed.

## What the spike must do

### Window 1 — Overlay
- Covers the primary display's **work area** (`screen.getPrimaryDisplay().workArea`), so the taskbar is not covered.
- Options: `transparent: true, frame: false, backgroundColor: '#00000000', focusable: false, skipTaskbar: true, resizable: false, hasShadow: false, thickFrame: false, alwaysOnTop: true`, then `setAlwaysOnTop(true, <level>)`. The level comes from a `--level` argument (default `floating`; also try `screen-saver`). Optionally `type: 'toolbar'` via a `--toolbar` flag.
- Renders a transparent R3F `<Canvas>` (`gl={{ alpha: true }}`, no background) with:
  - **"Critter":** a colored cube (~90 px tall), standing on the bottom of the work area at about 38 % of the width. It rotates slowly, so the GPU is visibly working.
  - A **DOM speech bubble** above it ("Hi! Hover me").
- **Orthographic camera**, 1 world unit = 1 CSS px.
- **Click-through:** default `setIgnoreMouseEvents(true, { forward: true })`. The renderer hit-tests the cursor against the critter's screen box (padded 8 px) and the bubble's rect. Inside → IPC `setInteractive(true)` → main `setIgnoreMouseEvents(false)`. Outside → `setIgnoreMouseEvents(true, { forward: true })` with a 60 ms leave-debounce. Send only on change.
- **Pointer modes:**
  - `--pointer forward` (default): uses forwarded mousemove events.
  - `--pointer poll`: main polls `screen.getCursorScreenPoint()` every 33 ms and hit-tests against shapes the renderer publishes over IPC (10 Hz).
- **On click** of the critter: it turns a different color and the bubble says "Clicked! #<count>".
- **Click-and-hold** the critter (≥ 250 ms): records the microphone with `MediaRecorder` until release. Then the bubble shows "Recorded <n> bytes, <mime>". Allow the `media` permission for our own page only (`session.setPermissionRequestHandler`).

### Window 2 — "Hub" (focus test)
- A small frameless, **focusable**, always-on-top window (360×200), top-right of the work area, `skipTaskbar: true`. Draggable by a header strip (`-webkit-app-region: drag`).
- Contains a text input. Typing there shows the text live in the overlay bubble over IPC ("Hub says: …").
- Esc blurs the Hub.

### On-screen diagnostics (overlay corner, small text)
Live values: display `scaleFactor`, `workArea`, `bounds`, pointer mode, level, `--toolbar` on/off, FPS, GPU status (`app.getGPUFeatureStatus().gpu_compositing`), interactive on/off.

### Printed report
When the app quits (Ctrl+Q from the Hub, or closing the Hub), print a block to stdout **and** write `spikes/x0-overlay/X0-REPORT.md`:

```
X0 REPORT
Electron <version> · Windows <release> · scaleFactor <n> · workArea <x,y,w,h>
GPU compositing: <status> · hardware acceleration: <on/off>
Pointer mode: <forward|poll> · AlwaysOnTop level: <level> · toolbar type: <on/off>
AUTO CHECKS
[PASS|FAIL] overlay window created with transparent:true and focusable:false
[PASS|FAIL] forwarded mousemove events received while ignoring mouse (count=<n>)
[PASS|FAIL] interactive toggled on at least once
[PASS|FAIL] critter click received on focusable:false window (count=<n>)
[PASS|FAIL] hub received keyboard input (chars=<n>)
[PASS|FAIL] mic recording produced bytes (<n>, <mime>)
[PASS|FAIL] FPS >= 30 while rotating (avg=<n>)
MANUAL CHECKS (Chanuth fills in)
[ ] background is transparent, not black
[ ] clicks pass through to apps underneath away from the critter
[ ] overlay is not in Alt-Tab or the taskbar
[ ] Hub takes typing focus; overlay never steals focus from the app you're using
[ ] looks right at this display scaling
```
Auto checks are computed from counters the app keeps (no manual input needed).

### README
`spikes/x0-overlay/README.md` with the exact commands:
```
cd spikes/x0-overlay
npm install
npm start                                   # defaults: forward pointer, floating level
npm start -- --pointer poll
npm start -- --level screen-saver --toolbar
npm run start:nogpu                         # if the background is black
```
Plus what to look for (the manual checks).

## Steps
1. Scaffold `spikes/x0-overlay/` (package.json, main, preload, renderer, bundling).
2. `npm install` inside `spikes/x0-overlay` and make `npm run build` succeed.
3. **Do NOT launch the app** (`npm start`). A human runs it on their own screen. Only build.
4. Make sure `.gitignore` coverage keeps `spikes/x0-overlay/node_modules` and build output out of git (the root `.gitignore` already ignores `node_modules/`, `dist/`, `out/`, `build/`; put bundle output in one of those).
5. Final message: list the files created, the build result, and the README commands.

## STOP conditions (stop and report; don't work around)
- Any usage-limit or auth error.
- You'd need to edit anything outside `spikes/x0-overlay/`.
- `npm install` fails twice for the same reason.
- Anything would require secrets or network services beyond npm.

## Rules
- No MCP tools, no network calls except npm install.
- No secrets anywhere.
- Throwaway quality is fine. Correct behavior and a clear report matter; polish doesn't.
