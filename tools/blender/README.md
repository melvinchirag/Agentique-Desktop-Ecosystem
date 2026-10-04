# ADE character delivery

ADE's documented Electron renderer uses React Three Fiber/Three.js and glTF 2.0 binary (`.glb`) directly. No FBX, OBJ or sprite conversion is required. The renderer and Asset Lab are not implemented in the checked main revision, so app playback remains a separate integration check.

Keep editable sources in `art/<animal_id>/` with Git LFS. Runtime GLB files belong in `src/renderer/public/characters/<animal_id>/default/model.glb`. Optional app tuning lives one level above the skin in `character.json`. HTML/PNG previews and their manifests are review artifacts.

## Build, validate, export

Run these commands from the repository root with Blender 5.2 available as `blender` (or use its full executable path):

```powershell
blender -b art/chipmunk/chipmunk.blend --python tools/blender/check_character.py -- chipmunk
blender -b art/chipmunk/chipmunk.blend --python tools/blender/export_character.py -- chipmunk
blender -b --python tools/blender/test_chip_export.py
```

The checker evaluates every required action and loop seam, including facial shape-key slots. It checks 30 fps, rig and triangle budgets, weights, transforms, origin, idle height, image size and materials. It changes the in-memory pose but never saves the source. Facing and visual quality need a human review. `required_clips.json` records the current full clip lists; incomplete tiers fail the full check rather than pretending completion. Chip's agent-specific twenty-action list overrides the generic Work/SleepWalk list. Other animals use the general asset brief; specialist briefs take precedence when their requirements change. Update the specification alongside the brief when needed.

The exporter runs those source checks first, exports selected rig/meshes with +Y up, sampled Actions, merged skeleton/morph actions and at most four weights, then checks GLB header, clip names, facial channels, skin budget, absence of cameras/lights and the 5 MB budget. It writes a temporary file and replaces the runtime GLB only after success. It records `validation.json` next to the GLB. Exporting does not commit or push.

Test actual exported animation playback by reimporting the GLB in Blender and playing every clip. Once the app Asset Lab exists, test the same file there: clip selection, 0.25-second transitions, looping versus one-shot behavior, code-driven motion, lip-sync and facial controls. A structural export check does not prove renderer integration.

## Commit and handoff

1. Check repository URL, branch, status and diff; use `chip/graphics` for Chip. Preserve unrelated edits.
2. Finish and validate the build, then commit explicit completed paths. Agent-assisted local commits are authorized after validation.
3. Ensure `git lfs install --local` has been run. `.gitattributes` already tracks `.blend` sources; GLB stays in normal Git.
4. Stage the intended source, runtime files and helpers, inspect staged paths, then commit with a message such as `chip(graphics): export validated Chip animations`.
5. Push when authorized, verify the remote commit, and report whether the LFS source also uploaded. A GitHub connection for text/API access does not guarantee terminal Git or LFS transport works.
6. Only Chanuth merges. Never merge, push directly to main, force-push or include personal assistant instructions in the asset delivery.

If a future renderer requires another format, add a documented converter from the authoring source or GLB, retain the originals, and test animation names, rig, morphs, axes, scale and materials in that renderer before committing. Do not convert speculatively.
