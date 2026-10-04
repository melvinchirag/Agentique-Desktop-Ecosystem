# ADE Asset Pipeline — Characters, Animations, Biomes

**For:** Zarin (3D + animation) and Shafeen (renderer).
**Goal:** Zarin exports a `.glb`, drops it in a folder, and it works in the app with no code changes.
Until a model or clip exists, the app shows a placeholder with procedural animation, so nobody waits on anybody.

---

## 1. Folder convention (drag and drop)

```
src/renderer/public/
├─ characters/
│   ├─ chipmunk/
│   │   ├─ default/model.glb        ← default skin
│   │   └─ character.json           ← optional tuning (see §5)
│   ├─ workspace/default/model.glb  ← Google Workspace character (design TBD)
│   ├─ wolf/default/model.glb
│   ├─ beaver/default/model.glb
│   ├─ eagle/default/model.glb
│   ├─ ants/default/model.glb       ← ONE ant; the app spawns the swarm
│   ├─ butterfly/default/model.glb  (extra)
│   └─ nightingale/default/model.glb(extra)
└─ biomes/
    └─ forest/
        ├─ biome.glb                ← terrain + props + home markers (see §6)
        └─ biome.json               ← sky, fog, light, ambient sound
```

- **Skins later:** `characters/wolf/snow/model.glb` is a new skin. Same rig and clip names, different look. The app lists skins by folder.
- **Biomes later:** `biomes/desert/`, `biomes/snow/` with the same marker names.
- In dev, drop a file in and press **Ctrl+R**. The packaged .exe bundles everything in `public/`.
- **Blender sources** live in `art/<animal_id>/<name>.blend` (Git LFS). Zarin's branch per animal: `<agent>/graphics`. Check + export scripts: `tools/blender/` (see `animations/Zarin_Graphics_and_Git_Plan.txt`).

---

## 2. Blender export settings (every character)

| Setting | Value |
|---|---|
| Format | glTF 2.0 **Binary (.glb)** |
| Include | Selected objects: mesh + armature only (no cameras/lights) |
| Transform | **+Y Up** (default). **Apply all transforms** (Ctrl+A → All Transforms) before export |
| Facing | Character faces **−Y in Blender** (Numpad 1 front view shows its face) |
| Origin | At the **feet, centered** (ground contact = 0) |
| Scale | Real relative heights in meters: chipmunk 0.35, ant 0.08, beaver 0.6, eagle 0.7 (perched), wolf 1.0, workspace char ~0.7 |
| Animation | Export mode **Actions**; every Action has **Fake User** (shield icon) so it isn't dropped; "Always Sample Animations" on |
| FPS | 30 |
| Skinning | Include skinning; **max 4 bone influences**; ≤ 60 bones |
| Shape keys | Export shape keys if present (used for mouth and blink, §4) |
| Materials | Principled BSDF only, image textures ≤ 1024 px. No procedural node trees (they don't export). |
| Budget | ≤ 15k triangles, ≤ 5 MB per character |

**Do not** bake mood colors into textures. Blue-when-scared and similar tints are applied in code.

---

## 3. Animation clips — exact names (case-sensitive)

The app plays clips **by name**. A missing clip falls back to procedural animation, so the app never breaks.
Fast mode: per animal only the essential clips listed in each animal's txt are required; the app animates the rest procedurally.
Looping clips: the first frame must equal the last frame.

### 3.1 Core set — every animal (priority order)

| # | Clip | Loop | Length | What it looks like | Used when |
|---|---|---|---|---|---|
| 1 | `Idle` | ✅ | 2–4 s | Breathing, small look-around, blink | Default |
| 2 | `Walk` | ✅ | 0.8–1.2 s cycle | In-place locomotion (no root motion; code moves the model). Birds: `Fly` instead | Moving across the desktop to another animal |
| 3 | `Talk` | ✅ | 1–2 s | Head bobs, gestures, mouth moves | Speaking (TTS playing) |
| 4 | `Work` | ✅ | 2–3 s | The animal's job motion (see §3.2) | Running tools |
| 5 | `Happy` | ❌ | 1–1.5 s | Hop / bounce / tail wag | Task done, user happy |
| 6 | `Scared` | ✅ | 1–2 s | Crouch, ears back, tremble | User angry/stressed (mood contagion) |
| 7 | `Think` | ✅ | 2 s | Head tilt, paw on chin | Waiting on the LLM |
| 8 | `Sad` | ✅ | 2 s | Droop, slow | User sad, task failed |
| 9 | `Sleep` | ✅ | 3 s | Curled up, slow breathing | Agent asleep (extras) |
| 10 | `Greet` | ❌ | 1.5 s | Wave / bow / wing flap | App start, nudges |
| 11 | `Yawn` | ❌ | 1.5 s | Big yawn, stretch | Falling asleep (idle timeout 1) |
| 12 | `SleepWalk` | ✅ | 1.2 s cycle | Drowsy, droopy walk (birds: slow `Fly`) | Going to the Agent Hub (timeout 2). **Not needed for Chip** (Chip never docks). |

**Minimum per animal: clips 1–6.** Clips 9, 11, 12 (`Sleep`, `Yawn`, `SleepWalk`) come next because every animal sleeps and docks. Make clips 1–6 for *all* animals before making 7–10 for *any* animal.

### 3.2 Signature clips (per animal)

| Animal | Agent | `Work` looks like | Extra clips |
|---|---|---|---|
| Chipmunk (Chip) | Orchestrator | — (Chip delegates, doesn't work) | **Full list: `animations/chip-actions.md`** (20 actions + face shape keys) |
| Workspace char | Google Workspace | Sorting / stamping letters | `Write`, `Handoff` |
| Wolf | Security | Sniffing / scanning, alert ears | `Guard` (tall alert stance, loop), `Growl` (lowered head, bared teeth), `Block` (leap forward + plant feet), `Howl`, `Sit` |
| Beaver | Files | Gnawing / carrying a log | `TailSlap`, `Carry` (walk while carrying, loop) |
| Eagle | Web research | — | `Fly` (loop), `Glide` (wings still, loop, used for circling), `Land`, `Takeoff`, `Perch` (= its Idle) |
| Ant | Planner | Carrying a leaf / task card | `Carry` (loop). Only Idle/Walk/Carry/Happy/Scared are needed. The app makes the swarm. |
| Butterfly (extra) | Social | — | `Fly` loop is enough; Idle = gentle wing fan |
| Nightingale (extra) | Music | `Sing` | `Fly`, `Perch` |

### 3.3 Optional face rig (big payoff if there's time)

Shape keys on the head mesh, with exact names:
- `MouthOpen` (0 → 1). **The app drives it from the TTS audio volume, so animals lip-sync to their ElevenLabs voices.**
- `Blink` (0 → 1). The app blinks randomly every 2–6 s.

Do these on the chipmunk first. It talks the most.

---

## 4. How the app uses the clips (Shafeen implements)

`Character.tsx` logic:

```
clipFor(state):
  sleeping → Sleep | listening → Listen ?? Idle | thinking → Think ?? Idle
  working → Work   | speaking → Talk             | moving → Walk/Fly/Run
mood overlay:  scared → Scared · happy/excited → Happy (one-shot) · sad → Sad · protective (wolf) → Guard
fallback:      clip missing → procedural (hop / bob / tremble / squash) for that state only
crossfade:     0.25 s between clips (drei useAnimations + action.crossFadeTo)
lip-sync:      if morph "MouthOpen" exists → value = smoothed RMS of the playing TTS audio (AnalyserNode)
tint:          emissive overlay per mood (blue when scared), done in code
```

**Asset Lab (dev screen, Shafeen, 30 min):** a hidden screen (Ctrl+Shift+A) where Zarin drags a `.glb` onto the window. It shows:
- the model, turntable-style
- each **required clip name** in green (found) or red (missing)
- buttons to play each clip, triangle count, bone count, and file size

This lets Zarin check exports without touching code.

---

## 5. `character.json` (optional tuning, no code changes)

```json
{
  "displayName": "Chip",
  "scale": 1.0,
  "yOffset": 0,
  "bubbleHeight": 0.5,
  "walkSpeed": 1.2,
  "clipMap": { "Work": "Scribble" },
  "sounds": { "greet": "sfx/chipmunk_chirp.mp3" }
}
```
`clipMap` lets a clip with a different name in Blender map to a required name without re-exporting.

---

## 6. Biome file (`biomes/forest/biome.glb`) — ⏸ DEFERRED

> **Decision (Oct 4):** the animals live directly on the real Windows desktop. Biome visuals are **deferred**, so Zarin skips this section for now. Animal spots on the desktop are set in code (`layout.ts`).

Build the clearing in Blender. Place **Empties** with these exact names where things should go. The app reads their positions:

| Empty name | Purpose |
|---|---|
| `home_chipmunk`, `home_workspace`, `home_wolf`, `home_beaver`, `home_eagle`, `home_ants`, `home_butterfly`, `home_nightingale` | Where each animal lives and idles |
| `stump_meeting` | The Meeting Stump where handoffs happen |
| `cam_default` | Default camera position (point the empty's −Z at the clearing) |
| `perch_eagle_circle` | Center of the eagle's circling path while it works |

Budget ≤ 40k triangles for the whole biome. Low-poly trees, rocks, a stream with a dam (beaver), a rock ledge (wolf), a tall pine (eagle), an anthill (ants).
If the biome isn't ready yet, the app uses a flat green plane plus procedural trees and hard-coded home positions.

`biome.json`:
```json
{ "sky": "#BFE3F2", "fog": ["#CFE8D8", 8, 40], "sun": { "color": "#FFF1D6", "intensity": 2.2 },
  "ambient": "sfx/forest_ambience.mp3" }
```

---

## 7. Zarin's order of work (about 12 hours)

| When | Deliverable |
|---|---|
| Now → 12:30 AM | Chipmunk: rig + `Idle`, `Walk`, `Talk`, `Work`, `Happy`, `Scared` → export → test in Asset Lab |
| 12:30 → 2:30 AM | Wolf model + rig + core 6 (+ `Block`, `Growl` — the demo needs them) |
| 2:30 → 4:30 AM | Workspace character model + rig + core 6 |
| 4:30 → 6:00 AM | Beaver + core 6 |
| 6:00 → 7:30 AM | Eagle (`Fly`, `Glide`, `Perch`, `Talk`, `Happy`, `Scared`) + Ant (one ant, 5 clips) |
| 7:30 → 8:30 AM | Forest biome with the named empties (a teammate can do this part from the spec) |
| 8:30 → 9:30 AM | Polish: chipmunk `Listen`/`Handoff`, `MouthOpen` shape key |
| After | Butterfly, Nightingale, skins |

**Honest check:** that's 6 rigged, animated characters in about 12 hours, which is a lot for one person. If a slot runs over, skip to the next animal with the core 6 clips; signature clips are the first thing to cut. Procedural fallback covers anything missing. Rigify (in Blender) speeds up quadruped rigs.
