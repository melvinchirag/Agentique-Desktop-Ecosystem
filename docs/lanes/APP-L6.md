# Lane L6 — Overlay UI: bubbles, cards, puffs, banner (AGY Gemini 3.8 Flash High, interactive)

Read `docs/lanes/APP-COMMON.md` first. **Deny every MCP tool prompt.** Do not launch the app unless
Chanuth tells you to.

## Objective
The DOM layer that floats over the 3D animals on the transparent overlay: speech/status bubbles that follow
each animal, the 💭 recall sparkle, ✓/✗ puffs, the Warden ApprovalCard, the inspect card, artifacts flying
into the Hub, and the REPLAY banner. Every visible piece registers its rect in the `HitRegistry` so it is
clickable while the rest of the screen stays click-through.

## Owned paths
- `src/renderer/overlay/ui/**`

## Spec to read
`00-APP-SHELL-SPEC.md` §3 (hit-testing; dragging a card), §7 (overlay column), §10 (inspect card);
`ARCHITECTURE.md` §5.4. Contracts: `OverlayUi`, `OverlayUiProps`, `OverlayUiComponent`, `BubbleKind`,
`HitRegistry`, `HubStoreHook`, `AgentRow`, `DesktopLayout` in `src/renderer/shell/contracts.ts`; `Rect` in
`src/main/shell/contracts.ts`; `AGENTS` in `src/shared/config.ts`.

## Steps (plain React + CSS; no new dependencies)
1. **`index.tsx`** exports `OverlayUiLayer: OverlayUiComponent` and calls `props.onReady(ui)` once with an
   object implementing every `OverlayUi` method (an imperative API backed by React state).
2. **Container**: `position: fixed; inset: 0; pointer-events: none` over the canvas. Interactive pieces
   (cards, their buttons) set `pointer-events: auto`. Transparent background, never a full-screen fill.
3. **Positioning**: bubbles, sparkles, puffs, and cards anchor to `props.getRect(agentId)` (overlay px):
   bubbles centered above the rect's top, cards beside the animal (flip to the other side near screen
   edges; clamp inside `layout.width`/`layout.height`). Follow moving animals with **one**
   `requestAnimationFrame` loop that runs **only while something is visible**, and stops otherwise.
   A `null` rect hides that agent's pieces.
4. **Hit shapes**: after layout each frame, `hit.set('bubble:<agentId>', 'bubble', rect)`,
   `hit.set('card:approval:<callId>', 'card', rect)`, `hit.set('card:inspect', 'card', rect)`,
   `hit.set('banner:replay', 'banner', rect)`; `hit.remove(...)` when they disappear. Use
   `getBoundingClientRect()`.
5. **Bubbles** (`showBubble`/`clearBubble`): one per agent, replaced by the next; kinds `say` (white,
   4 s default), `status` (smaller, muted, until cleared/replaced), `waiting` ("…" dots animation),
   `warning` (amber/red, 6 s). Pop-in/out animations ≤ 200 ms. Max ~24 characters per line, 2 lines.
6. **`sparkle(agentId)`**: 💭 rising and fading over ~1.2 s. **`puff(agentId, ok)`**: small ✓ (green) / ✗
   (red) puff over ~0.8 s.
7. **ApprovalCard** (`showApproval`/`closeApproval`): Warden avatar (color dot + "Warden"), `title`,
   `preview` (scrollable, max ~6 lines), **Allow** / **Deny** → `props.api.resolveApproval(callId, true|false)`;
   disable both after a click; the card closes on `closeApproval(callId)` (driven by `approval.resolve`).
   Several approvals stack.
8. **Inspect card** (`openInspect`/`closeInspect`; never for `chipmunk` — ignore it): name + role
   (`AGENTS`), presence, current job title + queued count (read `props.store` rows, live), **Wake** (only
   when `sleeping` or `docked`) → `props.api.wakeAgent(id)`, **Send to Hub** shown **disabled** with the
   title "Coming soon" (its API, `sleepAgent`, lands in a later contracts PR), **What I remember** →
   `props.shell.openHubTab('memories', id)`, close ✕. One inspect card at a time.
9. **Dragging cards** by their header with pointer capture; call `hit.setCaptured(true)` during the drag
   and `false` on release; keep the card inside the overlay.
10. **`flyToHub(agentId, label)`**: a small labeled chip flies from the agent to `layout.dockPoint` over
    ~0.8 s and fades.
11. **`setReplayBanner(on)`**: a "REPLAY 2×" banner at the top center.
12. Look: friendly, readable on any wallpaper (soft shadow + slight backdrop), animal accent colors.

## Tests you must add (`// @vitest-environment jsdom`, @testing-library/react; mock `HitRegistry`,
`api`, `shell`; store from `createHubStore(demoSeedState())`; fake timers)
`showBubble` renders and registers `bubble:<id>`; ttl expiry removes it and its hit shape; Allow →
`resolveApproval(callId, true)` and buttons disable; Deny → `false`; `openInspect('chipmunk')` does nothing;
Wake shows only for sleeping/docked and calls `wakeAgent`; "What I remember" → `openHubTab('memories', id)`;
replay banner registers `banner:replay`; nothing registered after everything closes; the rAF loop stops
when nothing is visible.

## Notes for W2a (put in your final message)
How to mount `OverlayUiLayer` above `CharacterCanvas` and any CSS it needs.

## Lane-specific STOP conditions
- Something you need isn't in `OverlayUiProps`/`OverlayUi`.
