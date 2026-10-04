# Lane L8 — Asset Lab window (AGY Gemini 3.8 Flash High, interactive)

Read `docs/lanes/APP-COMMON.md` first. **Deny every MCP tool prompt.** Do not launch the app unless
Chanuth tells you to.

## Objective
A read-only dev window for Zarin's models: drop in a `.glb` and immediately see whether it is ready for the
app — required clips found/missing, play any clip, triangle/bone counts, file size, morph targets.

## Owned paths
- `src/renderer/assetlab/**` (replace Wave 0's placeholder `main.tsx`)

## Spec to read
`00-APP-SHELL-SPEC.md` §14; `ASSETS.md` §1, §3 (clip names, minimum set, face shape keys), §5
(`character.json` `clipMap`); `animations/chip-actions.md`; `animations/archie-actions.md`.

## Steps (React + three / @react-three/fiber / @react-three/drei, all already installed; no new deps)
1. **Drop zone + file picker**: accept a `.glb` (and optionally a `character.json` so `clipMap` aliases
   count as found). Read with `FileReader`/`arrayBuffer()`, parse with three's `GLTFLoader.parse`. Show the
   file name and size. Errors → a readable message, never a crash.
2. **Turntable view**: an R3F canvas (normal opaque window, `dpr` 1), model auto-framed and slowly
   rotating, simple lights, drei `OrbitControls`; a ground grid.
3. **`analyze.ts`** (pure, tested in node): `analyzeGltf(scene, animations)` → `{ triangles, meshes, bones,
   clips: string[], morphTargets: string[], boundingBox: { width, height, depth } }`.
4. **`requiredClips.ts`** (pure, tested): a built-in copy of `ASSETS.md` §3 — core required (1–6: Idle,
   Walk, Talk, Work, Happy, Scared), recommended (Think, Sad, Sleep, Greet, Yawn, SleepWalk), and the
   per-animal signature lists (§3.2; Chip from `chip-actions.md`; Archie from `archie-actions.md`). Birds
   (eagle, butterfly, nightingale) accept `Fly` for `Walk`; Chip doesn't need `SleepWalk`.
   `checkClips(agentId, foundClips, clipMap?)` → `{ name, tier: 'required'|'recommended'|'signature',
   found: boolean, via?: string }[]`. An animal selector (default: guess from the file/folder name, else
   Chip) chooses the list.
5. **Checklist panel**: green ✓ / red ✗ per clip grouped by tier, with a summary line ("Ready: 6/6
   required"). Morph targets: highlight `MouthOpen` and `Blink` (found / missing). Triangles with a budget
   warning above 30 000.
6. **Clip player**: a button per clip found; plays it on the model (`AnimationMixer`, loop / once toggle).
7. Read-only: never writes files.

## Tests you must add (node environment)
`analyzeGltf` on a scene built in-test (a mesh + a skinned mesh + an `AnimationClip` list + a morph target)
returns the right counts; `checkClips` flags a missing required clip (spec §16 item 11), honors `clipMap`
aliases, the bird `Fly` rule, and Chip's no-`SleepWalk` rule.

## Manual check for Chanuth after merge
Settings → Asset Lab (or Ctrl+Shift+A in demo/dev mode), drop a `.glb`, see the checklist.

## Lane-specific STOP conditions
- three's `GLTFLoader` can't be imported in the renderer bundle without a new dependency.
