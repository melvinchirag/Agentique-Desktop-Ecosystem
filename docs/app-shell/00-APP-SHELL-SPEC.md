# App Shell — Spec v1 ✅ APPROVED (Chanuth, Oct 4)

> **Approved decisions:** S1 the Hub is its own small, movable, focusable window; the overlay never takes focus · S2 animals start on the taskbar's top edge (Chip center-left, right side clear under the Hub); **user-dragging animals anywhere on screen = post-MVP** · S3 orthographic camera, 1 unit = 1 px · S4 demo/dev hotkeys Ctrl+Shift+N / A / H are system-wide but registered **only in demo/dev mode** (user shortcuts stay deferred) · S5 the app shell owns the Electron main entry + preload; Chip's Lane J2 shrinks to an adapter + one-line swap (Melvin's plan is adjusted after his Chip work lands) · S6 `sleepAgent(id)` ("Send to Hub") lands in the follow-up contracts PR after Melvin's `contracts/shared` PR · S7 no cross-subscription backup: **if Codex hits a usage limit, the dispatcher stops and reports to Chanuth**; dispatch always runs from a separate parallel agent, never the main chat · The black-window GPU risk is tested on Chanuth's own PC (X0).

**Owner:** Chanuth · **Builders:** Chanuth's **Codex + AGY** (his Claude stays on planning) · **Branch:** `app/shell`
**Build plan:** `01-APP-SHELL-BUILD-LANES.md` · **Contracts:** `../ARCHITECTURE.md §3` (locked) · **Decisions:** `../DECISIONS.md`
**What it is:** the part of ADE you *see*. The animals live **directly on the real Windows desktop**. There's no app window, no hybrid, and no biome strip. The **Agent Hub** is the only app-like UI.
**Built now against a fake event stream.** Chip's core and Shafeen's sponsor kit plug in later (Lane J2), with no shell changes.

> ⚠ verify = an Electron/Windows behavior to confirm in the Wave 0 spike (X0) before lanes rely on it.

---

## 1. The experience in one paragraph
You start `ADE.exe`. The animals appear **along the bottom of your screen, standing on the taskbar's top edge**, over your normal apps, and wave. You keep working: your clicks go straight through to whatever is underneath, unless you click an animal, a speech bubble, or a card. A small **Agent Hub** box sits top-right (drag it anywhere). To talk, **click and hold Chip** (or the Hub's mic) and speak, or type in the Hub. Chip runs along the bottom of the screen to hand out work, Scout flies off the top edge to browse, an ant carries plan steps, Warden leaps in front of risky actions, and animals that stay idle fall asleep, then sleep-walk into the Hub.

---

## 2. Windows (process layout)

| Window | What | Key options |
|---|---|---|
| **Overlay** (1) | Transparent, full **work area** of the primary display (excludes the taskbar). Holds the 3D animals, bubbles, inspect cards, approval cards, and the replay banner. | `transparent: true, frame: false, backgroundColor: '#00000000', focusable: false` (on Windows this also implies `skipTaskbar: true`), `skipTaskbar: true, resizable: false, hasShadow: false, thickFrame: false, alwaysOnTop: true` → `setAlwaysOnTop(true, 'floating')` ⚠ verify the level (Electron #18982: some levels sit below the taskbar on Win32; since we cover the work area only, below the taskbar is fine), `type: 'toolbar'` (hides from Alt-Tab on Windows) ⚠ verify |
| **Agent Hub** (2) | Small frameless, **focusable**, always-on-top window (default 360×560, collapsible to 360×56), top-right of the work area. Chat, status, tabs, settings, onboarding, Marketplace panel. | `frame: false, transparent: false, alwaysOnTop: true, skipTaskbar: true, resizable: false`; drag by its header (`-webkit-app-region: drag`; buttons are `no-drag`) |
| **Asset Lab** (dev, 3) | Normal window for Zarin's model checks. Opened from Settings → Asset Lab (and Ctrl+Shift+A in dev/demo mode). | Regular window |

**Why the Hub is its own window:** typing needs keyboard focus. A separate focusable Hub window gets focus naturally, so the overlay can stay `focusable: false` and **never steals focus** from the user's apps. OS dragging is smooth, too. (A single-window design would need risky focus toggling.) **Decision S1 ✅.**

**Main process files:** `src/main/index.ts` (app boot: creates the windows, registers IPC with a `CoreAdapter`), `src/main/shell/overlayWindow.ts`, `hubWindow.ts`, `assetLabWindow.ts`, `display.ts`, `permissions.ts`, `demoShortcuts.ts`, `ipc/registerCoreIpc.ts`, `fake/*`.
**Preload:** `window.ade` (the locked `AdeApi`) + `window.adeShell` (shell-only window controls, §11).
**Renderer:** one Vite app with two entry pages: `overlay.html` and `hub.html` (+ `assetlab.html`).

---

## 3. Click-through and hit-testing

**Default:** the overlay ignores the mouse: `setIgnoreMouseEvents(true, { forward: true })`. Clicks go to the apps underneath, and mouse *moves* are still forwarded to the overlay page (Windows + macOS) so it can tell when you're over something.

**HitRegistry (renderer):** every interactive thing registers a screen-space shape, refreshed each frame:
- **Animals:** the projected bounding box of the model, padded 8 px (computed from the R3F camera).
- **Bubbles, inspect cards, approval cards, replay banner:** their DOM rects.

**Toggle rule:**
- On mousemove, if the point is inside any shape → `adeShell.setInteractive(true)` (main: `setIgnoreMouseEvents(false)`).
- On leaving → `setInteractive(false)` (main: `setIgnoreMouseEvents(true, { forward: true })`).
- Only send on change, with a 60 ms leave-debounce so moving between two shapes doesn't flicker.

**Fallback if forwarding is unreliable** ⚠ verify in X0 (e.g. when another app has focus, or over certain windows): main polls `screen.getCursorScreenPoint()` every 33 ms and hit-tests against the shapes the renderer publishes (`adeShell.publishHitShapes(rects)`, throttled to 10 Hz). Both paths sit behind `OverlayController.setPointerMode('forward' | 'poll')`.

**Dragging:** while interactive, pointer events go to the overlay. You can drag a card. *(Dragging animals anywhere on screen is **post-MVP**; for the MVP animals stay on the taskbar line.)* Releasing the mouse outside every shape returns to click-through.

---

## 4. Focus model
- **Overlay:** never focusable. Clicking an animal or card works without activating the window ⚠ verify that click events arrive on a `focusable: false` window.
- **Hub:** gets focus when clicked (typing in chat, settings). Pressing **Esc** or sending a message blurs the Hub (`hub.blur()`). The user's previous app regains focus via the OS.
- **Click-and-hold Chip to talk:** recording starts on overlay `pointerdown` over Chip, and ends on `pointerup` (or 30 s max). Mic capture doesn't need focus. A **short click (<250 ms)** on Chip focuses the Hub's text box instead.
- **Mic permission:** `session.setPermissionRequestHandler` allows `media` for our own origin only.

---

## 5. Desktop layout (`layout.ts`)

| Thing | Where |
|---|---|
| **Ground line** | Bottom of the work area − 4 px (animals stand on the taskbar's top edge). DIP coordinates; use `display.workArea` + `scaleFactor`. Test at 100/125/150 % ⚠ verify. |
| **Animal spots** | Along the ground, from the left: Swarm's colony 6 %, Archie 16 %, Pixel 26 %, **Chip 38 %**, Warden 50 %, Scout 60 % (perches on the ground; flies off when working), Iris 70 %, Celene 78 % (extras appear only when installed and awake). Right ~20 % stays clear under the Hub. |
| **Dock point** | Directly below the Hub window: animals sleep-walk along the ground to the Hub's x position, then float up and shrink into the Hub's header (0.6 s). Recomputed when the Hub is dragged. |
| **Fly-off** (Scout) | Takeoff → arc up and exit through the top edge; return on `job.update(done)`, landing at its spot. |
| **Camera** | **Orthographic**, 1 world unit = 1 CSS px, slight 12° downward tilt so models read as 3D. `character.json.scale` sizes each animal (Chip ≈ 90 px tall). |

Multi-monitor: **primary display only** for the hackathon. If the work area changes (taskbar moved, resolution), rebuild the overlay bounds and layout.

---

## 6. Character system (`CharacterLayer`)
- Loads `characters/<agentId>/<skin>/model.glb` (drei `useGLTF`) + optional `character.json` (scale, yOffset, bubbleHeight, walkSpeed, clipMap, sounds); skin `default`.
- **Clips by exact name** (`ASSETS.md §3`, Chip: `animations/chip-actions.md`), 0.25 s crossfades, one-shots return to the right loop.
- **Missing model** → placeholder capsule in the agent's color with eyes. **Missing clip** → procedural (hop, bob, tremble, squash, spin, slow-bob sleep).
- **Mood tint** by code (scared blue `#4A90E2`, nervous, happy, excited + sparkles, proud, sad desaturate, protective red rim, relieved, sleepy dim + "z").
- **Lip-sync:** `MouthOpen` morph from the speech audio's RMS (AnalyserNode, smoothed); if alignment data arrives, use it to start the bubble on the first word. `Blink` random 2–6 s.
- **Swarm:** one ant model instanced ×12 around the colony; the "ant carrier" is one instance walking out.
- **API (frozen in Wave 0):** `spawn(id)`, `despawn(id)`, `play(id, clip, {once})`, `moveTo(id, x, {gait:'walk'|'run'|'fly'|'sleepwalk'})` → Promise, `flyOff(id)` / `flyIn(id)`, `setMood(id, mood)`, `setMouth(id, 0..1)`, `screenRect(id)`, `dockInto(id, hubPoint)` / `undock(id)`.

**Frame budget:**
- `frameloop="demand"` with a 30 fps driver while anything animates; 10 fps when only idle loops play; **0 fps when everything is asleep, docked, or hidden**.
- `dpr = min(devicePixelRatio, 1.5)`.
- Target: idle CPU < 5 %, GPU memory < 300 MB.

---

## 7. AnimationDirector (events → choreography)
Per-agent state machine + an action queue (no overlapping moves). Uses `CharacterLayer` + `SpeechQueue` + `HubStore`.

| Event | Overlay does | Hub does |
|---|---|---|
| `user.message` | Chip `Listen` → `Think` | Transcript line |
| `user.mood` | — | Mood chip in header |
| `agent.status` | thinking → `Think`; working → `Work` + status bubble (`detail`); **away** (Scout) → `flyOff`; speaking → `Talk`; waiting_approval → sits, "…" bubble; error → `Dizzy` (Chip) / `Sad` | Status row text + timer |
| `agent.mood` | Tint + mood loop (`Scared`, `Nervous`, `Sad`, `Excited`); happy → `Happy` (≥0.8 → `Celebrate`); relieved → `Relief` | — |
| `agent.handoff` | Default: Chip `Run`s to the target, `Handoff` (scroll passes), Chip returns. **`via:'ants'`**: one ant walks from the colony to the target carrying the scroll. **Help job** (`agentId` ≠ chipmunk): the asker walks to the helper. Docked target → `undock` first. | Row: "running" |
| `agent.return` | Target turns toward Chip; Chip `Happy` hop | — |
| `agent.say` | Bubble with `bubble` text over the speaker; enqueue speech (§8) | Transcript (full `text`) |
| `agent.recall` | 💭 sparkle over the speaker | "💭 Remembered: …" line |
| `agent.presence` | sleeping → `Yawn` → `Sleep` + "z"; docked → `SleepWalk` to the dock point → `dockInto`; active from docked → `undock` → walk/fly home; startup → `Greet` | Row badge; Agents ▾ list |
| `job.update` | (handoff handles start) | Status row: title, running timer, queued position; Hub tray on done |
| `nudge.fire` | Chip `WakeUp` (if asleep) → walks to screen center-bottom → `Nudge` (knock SFX) | Notification dot |
| `tool.request` (risk ≥ write) | Warden's ears prick, turns toward the agent | — |
| `wolf.verdict` ask | Warden walks to the agent, sits; **ApprovalCard** next to Warden | "Approval waiting" badge |
| `wolf.verdict` deny | Warden `Block` (leaps in front) + `Growl` SFX + red rim | Audit tab refresh |
| `wolf.alert` | Warden `Howl`, warning bubble | Audit line |
| `approval.request` / `.resolve` | Show / close ApprovalCard | Badge on/off |
| `tool.result` | Small ✓/✗ puff over the agent | — |
| `artifact` | Item flies from the agent up into the Hub | Tray item (Open / Copy) |

**Replay mode:** the same director consumes stored events (`getTaskEvents`) through the EventPlayer at 2×, with a "REPLAY" banner. Real events are queued until it ends.

---

## 8. Speech queue (renderer, overlay)
- **One voice at a time.** Priority: `warden` > `chip` > `report` > `ack`. `report`/`ack` waiting > 8 s are dropped (the bubble still shows).
- Audio from `window.ade.speak(agentId, text, mood)` (Shafeen's VoiceService later; fake = bundled sample clips or silence).
- **Swarm chorus:** the same buffer ×3, detune ±25 cents, offsets 15/30 ms.
- SFX player reads `resources/sfx/manifest.json` (fallback: silent).
- `voiceEnabled = false` → bubbles only.

---

## 9. Agent Hub (window)
- **Header (drag area):** ADE logo + title (**click → Marketplace panel**), current user-mood chip, **Agents ▾** (docked animals → `wakeAgent`), **DND** toggle (`setDoNotDisturb`), "Hide animals" toggle (calm mode; hides the overlay), ⚙ settings, collapse.
- **Status rows** (always visible): avatar, name, presence badge, current job title + timer, queue count, pending approval. Click a row → that animal's inspect card on the overlay.
- **Tray:** artifacts (email draft → "Open in Gmail", file plan, research brief, social post → Copy).
- **Tabs:**
  - **Chat:** transcript (user + Chip + reports), text box, **mic** (hold).
  - **Memories:** animal picker → `getMemories` / `searchMemories` / `updateMemory` / `deleteMemory`.
  - **Pulse:** `getPulse` (mood this week, jobs per animal, Warden blocks); simple bars, no chart library.
  - **Audit:** `getWardenAudit(50)`, with a **Replay** button per task.
- **Marketplace panel (static):** cards for all animals (installed / wake), community agents (placeholder), skins, biomes (forest ✓, desert, snow "coming soon"), "Verified by Warden" badge.
- **Settings:** model per animal (from Backboard model list; fake list for now), voices on/off + volume, allowed folders (Archie), timers + **demo mode**, connect Google, Asset Lab.
- **Onboarding (first run):** 1) pick your AI, 2) connect Google (skippable), 3) voices on/off, 4) "Pixel is learning how you write" (disabled until Pixel exists). Then the animals spawn with `Greet`.

## 10. Inspect card (overlay, any animal but Chip)
Click an animal → card beside it: name + role, presence, current job + queue, **Wake** (if asleep) / **Send to Hub** (dock), "What I remember" (opens the Hub Memories tab for it), close ✕. No chat. *(The "Send to Hub" action needs `sleepAgent(id)`, a small contract addition; **decision S6 ✅**, lands in the follow-up contracts PR.)*

---

## 11. Shell-only interfaces (frozen in Wave 0; not part of `src/shared`)
- `window.adeShell`: `setInteractive(on)`, `publishHitShapes(rects)`, `getLayout()`, `onLayoutChanged(cb)`, `hubFocusChat()`, `openAssetLab()`, `onDemoHotkey(cb)`, `hideAnimals(on)`.
- `CoreAdapter` (main): implements every `AdeApi` IPC handler (`ARCHITECTURE §3.4`). **`FakeCore` now; `RealCore` (J2) wraps `createChipCore()` + Shafeen's VoiceService/MemoryApi/TigerQueries.** `registerCoreIpc(adapter)` is the only place that knows which one is in use.

## 12. Fake core and demo scripts (`src/main/fake/`)
`FakeCore` answers every IPC call and plays **scripts** (JSON: `[{ atMs, event }]`) through the same `ade:event` stream. `sendMessage` picks a script by keyword.

| Script | Shows |
|---|---|
| `boot` | Spawn + `Greet`, Chip hello |
| `email-digest` | Ack → handoff Pixel → report → Chip summary |
| `parallel` | Pizza (Scout flies off) + email (Pixel) at the same time |
| `angry-relief` | Shouting → Chip blue, contagion → "thanks" → relief |
| `warden-block` | "send it" → Warden `Block` + growl line |
| `approval` | Archie trash request → ApprovalCard → allow/deny paths |
| `ant-plan` | Melvin's report task: Swarm plans → 3 ant-carried steps (Archie, Scout, Pixel) |
| `sleep-dock-wake` | Uses demo timers: sleep → dock into the Hub → wake from Agents ▾ |
| `nudge` | Chip knocks: "How did the midterm go?" |
| `recall` | 💭 sparkle + memory line |

`speak()` → bundled short clips per agent (or silence). Memories, Pulse, and Audit → canned data. These scripts double as the **backup demo** if the network dies.

## 13. Demo hotkeys (decision S4 ✅)
Global hotkeys are deferred, so register `globalShortcut` **only when demo mode or dev mode is on**: **Ctrl+Shift+N** → `demoFireNudge`, **Ctrl+Shift+A** → Asset Lab, **Ctrl+Shift+H** → hide/show animals. They're unregistered otherwise and on quit.

## 14. Asset Lab (dev window)
Drag in a `.glb` → turntable view, required-clip checklist (green/red, from `tools/blender/required_clips.json` if present, else a built-in copy of `ASSETS.md §3`), play any clip, triangle/bone counts, file size, morph targets found. Read-only.

## 15. Packaging
`electron-builder.yml`: NSIS, `appId com.ade.agentique`, `productName ADE`, characters + sfx in `extraResources`, unsigned (SmartScreen: "More info → Run anyway"). Single-instance lock. Start-at-login **off**. Build by 9:30 AM and test on a second laptop.

## 16. Acceptance checks (the orchestrator runs them; manual where noted)
1. Overlay covers the work area; the taskbar stays usable; **no taskbar button or Alt-Tab entry** (manual).
2. **Click-through:** desktop icons and apps behind are clickable everywhere except animals, bubbles, and cards (manual, 10 spots).
3. Hovering an animal makes it clickable within 1 frame; leaving restores click-through.
4. Hub: drag, type, Esc returns focus; the overlay never steals focus (manual).
5. Every fake script in §12 plays with the right clips, bubbles, Hub rows, and speech order.
6. Sleep → dock → wake with demo timers; the dock point follows a dragged Hub.
7. Scout flies off and returns; ant carrier walks for `via:'ants'`; help-walk for a help job.
8. ApprovalCard Allow/Deny calls `resolveApproval`; Warden block plays.
9. Speech queue priority + 8 s drop; Swarm chorus; mouth moves with audio.
10. Replay of a recorded task at 2×.
11. Asset Lab flags a missing clip in a test `.glb`.
12. DPI 100/125/150 %: animals stand on the taskbar line (manual).
13. Idle CPU < 5 %, 0 fps when everything is asleep (Task Manager).
14. `npm run build:win` installer installs and runs on a second laptop.

## 17. Risks
| Risk | Plan |
|---|---|
| Transparent window renders **black** with GPU acceleration on some machines | X0 spike on the **demo laptop** first. Fallbacks: driver/flag tweaks; worst case, disable hardware acceleration (3D gets slow) ⚠ verify |
| Forwarded mouse-moves unreliable | Cursor-polling fallback (§3) |
| `focusable:false` window not receiving clicks | ⚠ verify in X0; fallback: toggle `setFocusable(true)` only while the pointer is over a shape |
| Other always-on-top apps or fullscreen video cover/fight the overlay | "Hide animals" toggle; level tweak; out of scope to solve fully |
| DevTools opening breaks transparency | Use detached DevTools on the Hub window only |
| GPU/battery drain | 0-fps idle rule, dpr cap |
| `package.json` / `src/main/index.ts` overlap with Melvin's Chip work | §18 ownership rules |

## 18. Ownership + integration rules (changes to other plans — **decision S5 ✅**)
- **The app shell owns** `src/main/index.ts`, `src/main/shell/**`, `src/main/ipc/registerCoreIpc.ts`, `src/main/fake/**`, `src/preload/**`, `src/renderer/**`, `electron.vite.config.ts`, `electron-builder.yml`, `resources/**` (non-sfx), and the Electron dependencies and scripts in `package.json`.
- **Chip's Lane J2 shrinks** to writing `src/main/core/realCore.ts` (a `CoreAdapter` wrapping `createChipCore()` + Shafeen's pieces) and swapping one line in `index.ts`. It no longer owns `index.ts` or the preload.
- The shell branches `app/shell` from `main` **after Melvin's `contracts/shared` PR merges** (it needs `src/shared` and his `package.json`). Until then, only the throwaway spike X0 runs.
