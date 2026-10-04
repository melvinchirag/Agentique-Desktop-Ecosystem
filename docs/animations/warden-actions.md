> **FINAL PLAN (Oct 4)**
> REQUIRED: Idle, Walk, Talk, Block, Growl, Sit. Every other clip is OPTIONAL.
> Ship order: push the STATIC model first (the app animates static models procedurally), then add clips one at a time and push after each clip.
> Everything else in this document is optional.

# Warden (Wolf) — Animation Actions for Zarin ✅ APPROVED (Oct 4)

> **FAST MODE (Oct 4): make ONLY these 6 essential clips — Idle, Walk, Talk, Block, Growl, Sit. Everything else is optional / done in code.**
> Every other clip: **OPTIONAL — skip for now**.

Same rules as Chip and Archie (`chip-actions.md`, `../ASSETS.md §2`):
- exact Action names, Fake User on, in place, 30 fps, loops seamless, no color animation
- `.glb` ≈ 1.0 m tall, faces −Y, origin at the feet
- Saved to `src/renderer/public/characters/wolf/default/model.glb`
- Blender source: `art/wolf/wolf.blend`
- Branch: `warden/graphics`

**Rig must-haves:** four legs that plant firmly (Block/Guard), tail with 4–5 bones, independent ears, a jaw that opens wide (Howl/Growl). No props.

**Warden never cowers (proposed):** his core set swaps **`Scared` → `Guard`** and **`Happy` → `Proud`**. `character.json` adds `"clipMap": { "Scared": "Guard", "Happy": "Proud" }` so the renderer's generic mood logic still works. `tools/blender/required_clips.json` "wolf" lists the names below. `character.json` lives at `src/renderer/public/characters/wolf/character.json`. No `Think` or `Sad` either (core clips 7–8): the renderer falls back to `Idle` / `Guard`. Tools: ChatGPT + Codex only (Zarin's plan).

## Wolf body language

| Mood | Ears | Tail | Posture | Face |
|---|---|---|---|---|
| Neutral | Relaxed, turning to listen | Low, still | Tall, calm | Slow blinks |
| Alert | Snap up and forward | Straight out | Frozen, head whipped toward the sound | Wide, focused |
| Protective (`Guard`) | Forward | Level, stiff | Legs planted wide, head low, half a pace in front | Eyes locked forward |
| Threat (`Growl`/`Block`) | Forward (never flat) | Stiff | Head low, hackles up | Lips back, teeth showing. Aimed at the threat, never the user |
| Proud | Up | High, slow wag | Chest out, chin up | Calm |
| Approving | Soft | Low | Still | Slow nod |
| Sleepy | Folded | Curled over the nose | Curled ball | Closed |

## Actions

| # | Name | Loop | Length | Looks like | When |
|---|---|---|---|---|---|
| **Tier 1 — demo** | | | | | |
| 1 | `Idle` | ✅ | 3 s | Standing tall, ears turning, slow look across the screen | Default; silent allows |
| 2 | `Walk` | ✅ | 1 s | Steady trot-walk, head level | Moving (e.g. to an approval card) |
| 3 | `Talk` | ✅ | 1.5 s | Slow deliberate head moves, jaw | Speaking his short lines |
| 4 | `Work` | ✅ | 2 s | "Scanning": eyes narrowed, slow head pan, ears rotating  **OPTIONAL — skip for now** |
| 5 | `Proud` | ✅ | 2 s | Chest out, chin up, tail high slow wag  **OPTIONAL — skip for now** |
| 6 | `Guard` | ✅ | 1.5 s | Legs planted wide, head low, steady (not trembling)  **OPTIONAL — skip for now** |
| 7 | `Block` | ❌ | 1 s | **Leaps forward, lands, plants all four feet**, head low facing out | **Blocking** a dangerous action |
| 8 | `Growl` | ❌ | 1.2 s | Head lowers, lips curl, teeth, hackles rise | With a block / repeated attempts |
| 9 | `Sit` | ✅ | 2 s | Sits upright and calm, ear flicks | **Beside an approval card** |
| **Tier 2 — security moments** | | | | | |
| 10 | `Alert` | ❌ | 0.6 s | Ears snap up, head whips sideways, freeze  **OPTIONAL — skip for now** |
| 11 | `Nod` | ❌ | 0.8 s | One slow nod  **OPTIONAL — skip for now** |
| 12 | `Howl` | ❌ | 2 s | Sits back, head to the sky, long howl  **OPTIONAL — skip for now** |
| 13 | `Run` | ✅ | 0.6 s | Fast low lope  **OPTIONAL — skip for now** |
| 14 | `Sniff` | ✅ | 2 s | Nose low, sweeping  **OPTIONAL — skip for now** |
| **Tier 3 — sleep** | | | | | |
| 15 | `Yawn` | ❌ | 1.5 s | Big yawn, tongue curl, stretch  **OPTIONAL — skip for now** |
| 16 | `Sleep` | ✅ | 4 s | Curled, tail over nose  **OPTIONAL — skip for now** |
| 17 | `SleepWalk` | ✅ | 1.2 s | Droopy walk, eyes half-closed  **OPTIONAL — skip for now** |
| 18 | `WakeUp` | ❌ | 1.2 s | Head pops up, full-body shake  **OPTIONAL — skip for now** |
| **Tier 4** | | | | | |
| 19 | `Greet` | ❌ | 1.5 s | Calm head bow, slow tail wave  **OPTIONAL — skip for now** |

**Optional shape keys:** `MouthOpen`, `Blink`, `Snarl` (lips back), `Hackles` (fur ridge).
**Don't make:** `Scared`, `Happy`, `Nervous`, `Sad`, `Excited`, `Think`, talking-while-growling variants, or color changes.

## Mood / event → clip

| Mood or event | Clip |
|---|---|
| neutral | `Idle` |
| protective | `Guard` |
| proud | `Proud` |
| sleepy | `Yawn` → `Sleep` |
| `wolf.verdict: ask` | `Alert` → `Walk`/`Run` to the asking animal → `Sit` (the ApprovalCard appears beside him) |
| `approval.resolve` | `Nod` → walk back |
| `wolf.verdict: deny` | `Run` (if far) → `Block` + `Growl` (red rim light in code) |
| `wolf.alert` | `Howl` |
| reviewing content | `Sniff` / `Work` |

## Order and time (Warden only)

| Step | Work | Time |
|---|---|---|
| 1 | Model + rig | ~70 min |
| 2 | `Idle`, `Walk`, `Talk`, `Work`, `Proud`, `Guard` | ~60 min |
| 3 | `Block`, `Growl`, `Sit` | ~40 min |
| 4 | Check + export → push | ~10 min |
| 5 | Tier 2 | ~45 min |
| 6 | Tier 3 | ~30 min |
| 7 | Tier 4 | ~10 min |

**Total ≈ 4–4.5 h.** Steps 1–4 first. Everything else has code fallbacks.
