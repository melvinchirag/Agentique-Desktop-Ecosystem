# Lane L3 — CharacterLayer (Codex GPT-6 Sol, medium)

Read `docs/lanes/APP-COMMON.md` first.

## Objective
The 3D layer that puts the animals on the real desktop: a transparent R3F canvas over the whole overlay,
GLB loading with drag-and-drop assets, clips by exact name with crossfades, placeholders and procedural
fallbacks, mood tints, lip-sync/blink morphs, Swarm, movement, and screen rects for hit-testing — all within
a CPU-rendering budget.

## Owned paths
- `src/renderer/overlay/characters/**`

## Spec to read
`00-APP-SHELL-SPEC.md` "X0 results", §5 (camera row), §6, §17 (GPU rows); `ASSETS.md` §1, §3, §4, §5;
`animations/chip-actions.md` (Chip's clip names); `ARCHITECTURE.md` §5.2 (mood tint colors).
Contract: `CharacterLayer`, `CharacterCanvasProps`, `CharacterCanvasComponent`, `DesktopLayout`,
`HitRegistry`, `Gait`, `Facing` in `src/renderer/shell/contracts.ts`; `Rect`/`Point` in
`src/main/shell/contracts.ts`.

## Steps
1. **`index.ts`** exports `CharacterCanvas` (typed `CharacterCanvasComponent`) and nothing that other lanes
   must import besides it. Internals live in sibling files.
2. **Canvas + camera**: R3F `<Canvas>` filling the overlay, transparent (`gl={{ alpha: true,
   antialias: false, powerPreference: 'low-power' }}`, clear alpha 0), `dpr={1}`, `frameloop="demand"`.
   Orthographic camera, **1 world unit = 1 CSS px**. Put all coordinate mapping in `coords.ts`
   (overlay-local px ↔ world), unit-tested. Feet of a grounded animal sit exactly on
   `layout.groundY`. The "12° downward tilt" is a per-character root rotation toward the camera, so the
   ground line stays exact. The canvas element itself must not block clicks (the overlay window decides via
   `HitRegistry`; set `pointer-events: none` on the canvas).
3. **Frame driver** (`fps.ts`, pure + tested): 30 fps while anything moves, crossfades, plays a one-shot,
   talks (mouth > 0), or tints; 10 fps when only idle loops play; **0 fps** when every animal is asleep,
   docked, hidden, or the layer is invisible. Drive `invalidate()` from one timer; stop the timer at 0 fps.
4. **Loading**: for each spawned id, fetch `${assetBase}/${id}/default/character.json` (optional) and load
   `model.glb` (drei `useGLTF` or `GLTFLoader`; clone per instance with `SkeletonUtils.clone`). A 404 or
   parse error → **placeholder**: a capsule in `AGENTS[id].color` with two eyes, same size rules. One bad
   model never breaks the others (error boundary per character). `character.json` fields: `scale`,
   `yOffset`, `bubbleHeight`, `walkSpeed`, `clipMap`, `sounds` (ignore unknown fields). Default heights
   (px): chipmunk 90, workspace 100, wolf 110, beaver 85, eagle 95, ants 18 (each ant), butterfly 60,
   nightingale 60. Warn in dev if a model exceeds 30 000 triangles.
5. **Clips** (`clips.ts`): `AnimationMixer` per animal; resolve names through `clipMap`; 0.25 s crossfades;
   `once` → `LoopOnce` + `clampWhenFinished`, then crossfade back to the current loop and resolve. Loops
   become the current loop and resolve immediately. **Missing clip → procedural** (pure mapping, tested):
   hop (Happy, Celebrate, Greet, Excited, Relief), bob (Idle, Talk, TalkHappy, Listen, Think), tremble
   (Scared, Nervous, TalkScared, Worried), squash (Work, Handoff, Nudge, Block, TailSlap), spin (Dizzy),
   slow-bob (Sleep, Yawn, WakeUp), gait bob (Walk, Run, SleepWalk, Fly, Carry); unknown → bob. Procedural
   one-shots last ~1 s.
6. **Movement** (`motion.ts`, pure tween math tested with a fake clock): `moveTo` along the ground with gait
   speeds (px/s) walk 120, run 260, sleepwalk 60, fly 300 (× `walkSpeed` if set); faces the direction of
   travel; plays `Walk`/`Run`/`SleepWalk`/`Fly` during and restores the previous loop on arrival.
   A newer move/flyOff/dockInto for the same id resolves the older promise early. `flyOff`: `Takeoff` then
   an arc up and out past the top edge, then hidden. `flyIn(x)`: arc in from the top, `Land`, grounded at x.
   `dockInto(p)`: float up + shrink into p over 0.6 s, hidden. `undock(x)`: reappear at the last dock
   point, grow, drop to the ground at x.
7. **Mood tint** (`mood.ts`, table tested): per-instance cloned materials; lerp an emissive overlay: scared
   `#4A90E2`, nervous `#8FB3D9`, happy `#FFD36E`, excited `#FF9EC7` + a few sparkle points, proud
   `#FFC34D`, sad = desaturate 60 %, protective = `#B0413E` rim/emissive pulse, relieved = soft warm,
   sleepy = dim + a floating "z" sprite (canvas texture, no DOM), neutral = none. `intensity` scales it.
8. **Face**: `setMouth` smooths toward the target and drives the `MouthOpen` morph if present, else a small
   procedural head/jaw scale. `Blink` morph randomly every 2–6 s if present (placeholder: eye scale).
9. **Swarm** (`ants`): the colony is 12 small ants around `colonyX` (InstancedMesh for the placeholder;
   clones for a GLB), idling with phase offsets. `antCarrier(fromX, toX)`: a temporary ant with a scroll
   walks the ground and vanishes on arrival. `setProp(id, 'scroll')`: a small scroll mesh at the animal.
10. **Rects + hit shapes**: `screenRect(id)` projects the instance's bounding box (computed once per model
    at load, then offset/scaled) to overlay px; `position(id)` = feet. Every rendered frame, register
    `animal:<id>` with the bbox **padded 8 px** in `props.hit`; remove when hidden/despawned/invisible.
11. `setVisible(false)` hides everything, clears hit shapes, drops to 0 fps. `setLayout` re-grounds
    everyone (animals keep their x unless outside the new width).

## Tests you must add (node environment, no WebGL)
coords mapping; fps decisions (30/10/0); procedural clip mapping + `clipMap` resolution; tween math
(arrival time, cancel-older-resolves); mood table; `screenRect` projection with a real three
`OrthographicCamera` (three's math works in node); padded hit-shape registration with a mock `HitRegistry`.

## Notes for W2a (put in your final message)
How to mount `CharacterCanvas`, the exact props, and any CSS it needs.

## Lane-specific STOP conditions
- The `CharacterLayer` contract can't express a needed behavior (e.g. a clip API the director must call).
