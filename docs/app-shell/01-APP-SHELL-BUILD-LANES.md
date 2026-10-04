# App Shell — Parallel Build Plan (Codex + AGY) · ✅ APPROVED (Chanuth, Oct 4)

**Builds:** `00-APP-SHELL-SPEC.md` (every lane reads it)
**Operator:** Chanuth · **Engines:** **Codex + AGY only** (Claude is reserved for planning; Opus is an *optional* reviewer if Chanuth wants it)
**Method:** Hydra flow plan (`C:\Chanuth\hydra\models.json`, `docs/ORCHESTRATOR.md`): one orchestrator plans, dispatches, audits, and merges; lanes run in isolated worktrees; cheapest model that meets each floor; **implementers never get MCP access**.
**Branch:** `app/shell`; lanes `lane/app-shell-<x>` (see `../GIT-WORKFLOW.md`).
**Target:** every fake demo script playing on the real desktop as an installable `.exe`, ≈ 3.5 h after the contracts land.

---

## X0 results (Chanuth's laptop, Oct 4)
- Transparency, click-through, test-creature hover/click, click-and-hold mic recording, Hub typing/focus, and 125% placement all worked (work area 1536x816 DIP; creature bottom aligned to the taskbar top).
- Defaults: pointer `forward`, always-on-top `floating`, toolbar off. Polling, `screen-saver` level, and toolbar variants showed no visible difference; retain as fallbacks only.
- GPU compositing is `disabled_software` even with `--ignore-gpu-blocklist`; keep `devicePixelRatio = 1`, the 30 moving / 10 idle / 0 asleep FPS caps, and per-character triangle budgets. W2a adds a performance check with six dummy animated models.
- Alt-Tab visibility is unconfirmed and stays a W2b manual check. The diagnostics panel was spike-only; the real app shows it only in dev mode.

## 1. Heads

| Engine | Model | Band | Role |
|---|---|---|---|
| Codex | **GPT-6 Astra** | frontier (88.7) | **Orchestrator** (high): specs, dispatch, audit, merge |
| Codex | **GPT-6 Sol** | strong (79.2) | Fragile Windows + 3D lanes |
| Codex | **GPT-6 Luna** | value (65.0) | Well-specified, simpler modules |
| AGY | **Gemini 3.8 Flash High** | value (73.9) | UI lanes (React panels); never a strong-floor lane |

**Caveat:** only two subscriptions (Codex, AGY). For strong-floor lanes the backup is GPT-6 Astra on the *same* Codex subscription, so **if Codex hits its usage limit, the dispatcher STOPS and reports to Chanuth** — no fallback to another subscription (decision S7 ✅). **Dispatch always runs from a separate parallel agent, never Chanuth's main chat.**

---

## 2. Waves

```
X0 SPIKE  (now, throwaway, outside the repo, ~20 min) — Codex GPT-6 Sol medium
   transparent full-work-area window + R3F cube + click-through toggle + focusable Hub window + mic test
   → X0 results recorded below; Alt-Tab visibility remains for a W2b manual check
WAVE 0  (Astra, ~30 min, starts when Melvin's contracts/shared PR is merged into main)
   branch app/shell → add Electron (electron-vite, electron-builder, three, @react-three/fiber, drei, zustand)
   → freeze shell interfaces → lane files docs/lanes/SHELL-<X>.md → worktrees
WAVE 1  (parallel, ~75–90 min)
   L1 Windows + click-through + focus + IPC plumbing .. Codex GPT-6 Sol  high    (strong)
   L2 FakeCore + demo scripts + EventPlayer .......... Codex GPT-6 Luna medium  (value)
   L3 CharacterLayer (GLB, clips, fallback, tint) .... Codex GPT-6 Sol  medium  (strong)
   L4 AnimationDirector + layout + movement .......... Codex GPT-6 Sol  high    (strong)
   L5 Agent Hub window UI ............................ AGY  Gemini 3.8 Flash High (value)
   L6 Overlay UI: bubbles, inspect/approval cards .... AGY  Gemini 3.8 Flash High (value)
   L7 Audio: speech queue, lip-sync, chorus, SFX, mic  Codex GPT-6 Luna high    (value)
   L8 Asset Lab window ............................... AGY  Gemini 3.8 Flash High (value)
      merge order: L2 → L1 → L3 → L7 → L4 → L6 → L5 → L8
WAVE 2  (~45 min) — W2a end-to-end wiring + perf pass (Codex Sol medium) · W2b packaging + second-laptop test (Codex Luna medium)
LATER  — J2 at team integration: RealCore swaps FakeCore (Melvin's lane, 25 min)
```

**Codex load:** Sol ×3 + Luna ×2 at the same time. Stagger the dispatches (L1, L2, L3 first; L4, L7 ten minutes later) to stay under the rate limit.

---

## 3. Wave 0 — orchestrator setup (Astra high)

| Step | What | Done when |
|---|---|---|
| 0.1 | Record X0 results and set pointer mode + GPU fallback in the spec | Results recorded in this plan and `00-APP-SHELL-SPEC.md` |
| 0.2 | Check that Melvin's `contracts/shared` is on `main` (`git ls-tree origin/main src/shared`). Then `git switch -c app/shell main` | Branch pushed |
| 0.3 | Add Electron on top of Melvin's `package.json` (deps + scripts `dev`, `build:win`); `electron.vite.config.ts` with entries main/preload/renderer (`overlay.html`, `hub.html`, `assetlab.html`); `electron-builder.yml` (spec §15) | `npm run dev` opens an empty overlay + Hub |
| 0.4 | **Freeze shell interfaces** in `src/renderer/shell/contracts.ts` + `src/main/shell/contracts.ts`: `OverlayController`, `HitRegistry`, `CharacterLayer` (spec §6 API), `SpeechQueue`, `HubStore` (zustand shape: agents{presence,status,mood,job,queue}, transcript, tray, approvals, settings), `EventPlayer`, `CoreAdapter`, `Layout`, `window.adeShell` | `tsc --noEmit` passes |
| 0.5 | Event bus wiring: main broadcasts `ade:event` to **both** overlay and Hub; a stub `CoreAdapter` answers every IPC call | Both windows log events |
| 0.6 | Lane files `docs/lanes/SHELL-L1..L8.md` (objective, owned paths, spec §§, steps, tests, STOP conditions); worktrees `git worktree add ../ade-wt-app-shell-<x> -b lane/app-shell-<x> app/shell` | 8 worktrees |

**Freeze rule:** after 0.4 the shell interfaces change only through the orchestrator (all lanes then rebase). `src/shared/*` is Melvin's: never edited here.

---

## 4. Lane table

| Lane | Builds (spec §) | Engine / model / effort | Floor | Backup | Owned paths | Est. |
|---|---|---|---|---|---|---|
| **X0** | Spike: transparency, click-through, focus, mic, GPU compositing, and DPI results recorded above | Chanuth · Oct 4 | complete | — | throwaway spike (never merged) | done |
| **L1** | Overlay + Hub + Asset Lab windows, display/work-area + DPI, `OverlayController` (forward + poll modes), `setInteractive`, hit-shape intake, Hub drag/focus/Esc blur, permissions (mic), demo `globalShortcut`s (§13), single-instance, hide-animals | Codex · Sol · **high** | strong | Astra medium | `src/main/index.ts`, `src/main/shell/**`, `src/preload/**` | 75 min |
| **L2** | `FakeCore` (every `AdeApi` handler), 10 demo scripts (§12), `EventPlayer` (play/pause/speed, used for Replay too), canned memories/pulse/audit, bundled sample voice clips | Codex · Luna · medium | value | AGY Flash High | `src/main/fake/**`, `src/main/ipc/registerCoreIpc.ts`, `resources/fake/**` | 60 min |
| **L3** | `CharacterLayer`: R3F canvas (transparent, ortho camera, `dpr = 1`, 30/10/0 fps driver), GLB loading, clip playback by name + crossfade, `character.json`, placeholder + procedural fallback, mood tints, morph `MouthOpen`/`Blink`, Swarm instancing, `screenRect()` | Codex · Sol · medium | strong | Astra low | `src/renderer/overlay/characters/**` | 80 min |
| **L4** | `AnimationDirector` (spec §7 table, action queue per agent), `layout.ts` (§5), movement (walk/run/fly-off/fly-in/sleepwalk/dock/undock), ant carrier, help-walk, Replay mode + banner | Codex · Sol · **high** | strong | Astra medium | `src/renderer/overlay/director/**`, `src/renderer/overlay/layout.ts` | 90 min |
| **L5** | Hub window UI (§9): header, status rows, Agents ▾, DND, hide toggle, tray, tabs Chat/Memories/Pulse/Audit, Settings, Onboarding, Marketplace panel | AGY · Gemini 3.8 Flash High | value | Codex Luna high | `src/renderer/hub/**` | 90 min |
| **L6** | Overlay UI: bubble layer (positioned from `screenRect`), status bubbles, 💭 sparkle, inspect card (§10), ApprovalCard, ✓/✗ puffs; each registers in `HitRegistry` | AGY · Gemini 3.8 Flash High | value | Codex Luna high | `src/renderer/overlay/ui/**` | 70 min |
| **L7** | `SpeechQueue` (§8: priority, 8 s drop, one voice), playback + AnalyserNode → `setMouth`, Swarm chorus, SFX player, voice-off mode; mic: click-and-hold Chip / Hub mic → MediaRecorder → `sendVoice` | Codex · Luna · **high** | value | AGY Flash High | `src/renderer/audio/**` | 60 min |
| **L8** | Asset Lab window (§14) | AGY · Gemini 3.8 Flash High | value | Codex Luna medium | `src/renderer/assetlab/**` | 45 min |
| **W2a** | Wire everything end to end; run every acceptance check (spec §16); perf pass (CPU/GPU budget), including six dummy animated models | Codex · Sol · medium | strong | Astra medium | glue files only, listed by the orchestrator | 30 min |
| **W2b** | Packaging: NSIS build, extraResources, single-instance, manual Alt-Tab visibility check, test on a second laptop | Codex · Luna · medium | value | AGY Flash High | `electron-builder.yml`, `build/**` | 20 min |

**Lane independence:** L3–L8 code only against the frozen interfaces, with **mocks** of the others: L4 drives a mock `CharacterLayer` that logs calls; L5/L6 render from a seeded `HubStore`; L7 tests with a sample mp3. Nothing in Wave 1 waits on another Wave 1 lane.

---

## 5. Lane specs (what each `docs/lanes/SHELL-<X>.md` says; the orchestrator fills them in)
Every lane file has six parts: **objective · owned paths · spec sections to read · steps · tests the lane must run · STOP conditions.**
Common STOP conditions:
- a frozen interface can't express something you need
- a ⚠ verify behavior fails on this machine
- any need to touch `src/shared/*` or paths you don't own

**Tests:**
- vitest for pure logic: HitRegistry, SpeechQueue priority/drop, Director state machine with a mock layer, EventPlayer timing with a fake clock, layout math at 3 DPIs.
- Manual checklist items for window behavior (spec §16), reported with screenshots or a short note.

---

## 6. Dispatch commands (PowerShell)
- **Codex lane (headless, no MCP)**, inside the lane's worktree:
  `Get-Content -Raw ..\<repo>\docs\lanes\SHELL-L1.md | codex exec - -m gpt-6-sol -c model_reasoning_effort="high" --ignore-user-config --disable apps -C . --color never -o ..\shell-l1-final.md`
  Add `-s danger-full-access` only if the Windows sandbox errors (safe only because it's a throwaway worktree). Never pass prompts as quoted arguments.
- **AGY lane (interactive):** terminal in the worktree → `agy --model gemini-3.8-flash-high` → accept-edits → "Read docs/lanes/SHELL-L5.md and do exactly that lane. Run its tests. Stop and tell me if a STOP condition hits." **Deny every MCP tool prompt.**
- **Orchestrator:** an interactive Codex session at the repo root: `codex -m gpt-6-astra -c model_reasoning_effort="high" --ignore-user-config --disable apps` + the PROMPTS.md prompt.

---

## 7. Audit + merge (orchestrator)
1. Re-run each lane's tests yourself, plus its manual checks on Chanuth's machine.
2. `git diff --stat app/shell...lane/app-shell-<x>`: owned paths only, no secrets.
3. Fragile code (L1 pointer/focus, L4 director) gets a second look by **GPT-6 Sol on a fresh session** (or Opus if Chanuth lends it).
4. Merge into `app/shell` one at a time: **L2 → L1 → L3 → L7 → L4 → L6 → L5 → L8**, then W2a → W2b. `npm test` + `npm run dev` smoke after each merge. Push.
5. **Escalation:** one effort notch → the backup column → fix the spec.
6. Done → PR `app/shell → main` (Chanuth merges it first at the integration checkpoint, per `GIT-WORKFLOW.md §4`).

---

## 8. Timeline (clock starts when Melvin's contracts PR merges, ~2:15 AM expected)

| Clock | Milestone |
|---|---|
| now | **X0 spike complete**; results recorded above (doesn't need the contracts) |
| +0:00 | Contracts on `main` → Wave 0 |
| +0:30 | Wave 0 done; L1, L2, L3 dispatched; L4–L8 ten minutes later |
| +2:00 | Wave 1 lanes report; audits + merges |
| +2:45 | W2a: all 10 fake scripts play end to end on the desktop |
| **+3:30** | W2b: **installable `.exe`**, tested on a second laptop. Ready for J2 (real Chip core + sponsor kit) |
