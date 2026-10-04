> **FINAL PLAN (Oct 4)**
> REQUIRED: Idle, Walk, Talk, Happy. OPTIONAL: Carry, HoldNote, and any of Chip clip names (Chip rig names are valid).
> Ship order: push the STATIC model first (the app animates static models procedurally), then add clips one at a time and push after each clip.
> Everything else in this document is optional.

# Archie (Beaver) — Animation Actions for Zarin

> **FAST MODE (Oct 4): make ONLY these 6 essential clips — Idle, Walk, Talk, Happy, Carry, HoldNote. Everything else is optional / done in code.**
> Every other clip: **OPTIONAL — skip for now**.

Same rules as Chip (`chip-actions.md`, `../ASSETS.md §2`):
- exact Action names, Fake User on, in place, 30 fps, loops seamless, no color animation
- `.glb` ≈ 0.6 m tall, faces −Y, origin at the feet
- Saved to `src/renderer/public/characters/beaver/default/model.glb`
- Blender source: `art/beaver/beaver.blend`
- Branch: `beaver/graphics`

**Rig must-haves:** a flat paddle tail (3–4 bones; it must lift and slap), jaw + big front teeth (gnaw), small ears, paws that can hold objects (log, paper), whiskers optional.
**Props** (separate meshes parented to a hand bone, shown/hidden per clip): `Prop_Log`, `Prop_Paper`.

## Beaver body language

| Emotion | Ears | Tail | Posture | Face | Paws |
|---|---|---|---|---|---|
| Neutral | Relaxed | Flat on the ground, small sway | Upright on haunches | Calm, blinking | Resting on belly |
| Happy | Perked | Lifted, quick wag | Bouncy | Buck-tooth grin | Little claps |
| Excited | Up | Fast slaps on the ground | Hopping | Big grin, eyes wide | Fists pumping |
| Nervous | Twitching | Curled under | Hunched, shifting weight | Glancing sideways, teeth chattering | Wringing |
| Scared | Flat | Tucked tight | Crouched low, trembling | Wide eyes | Covering face |
| Sad | Drooped | Dragging | Slumped | Looking down | Limp |
| Sleepy | Folded | Wrapped around like a blanket | Curled ball | Closed | Under chin |

## Actions

| # | Name | Loop | Length | Looks like | When |
|---|---|---|---|---|---|
| **Tier 1 — demo** | | | | | |
| 1 | `Idle` | ✅ | 3 s | Breathing, whisker twitch, tail sway, looks around | Default |
| 2 | `Walk` | ✅ | 1 s | Waddle on all fours, tail dragging | Moving across the desktop |
| 3 | `Talk` | ✅ | 1.5 s | Head bobs, paw gestures, teeth show on emphasis | Speaking |
| 4 | `Work` | ✅ | 2 s | **Gnawing** a log held in both paws (`Prop_Log`)  **OPTIONAL — skip for now** |
| 5 | `Happy` | ❌ | 1.2 s | Hop + grin + tail wag | Done / user happy |
| 6 | `Scared` | ✅ | 1.5 s | Crouched, trembling, covers face  **OPTIONAL — skip for now** |
| 7 | `Carry` | ✅ | 1 s | Waddle-walk carrying a log on his shoulder (`Prop_Log`) | Moving files (applying a plan) |
| 8 | `TailSlap` | ❌ | 0.8 s | Tail lifts and slaps the ground once, proud nod  **OPTIONAL — skip for now** |
| 9 | `Read` | ✅ | 2 s | Holds a paper to his face, eyes scanning left-right (`Prop_Paper`)  **OPTIONAL — skip for now** |
| 10 | `HoldNote` | ✅ | 2 s | Holds the paper up toward the camera with both paws, small bob (`Prop_Paper`) | **"Talking file"**: the file's line is spoken |
| **Tier 2 — emotions + teamwork** | | | | | |
| 11 | `Nervous` | ✅ | 2 s | Fidgeting, teeth chattering, glancing at Warden  **OPTIONAL — skip for now** |
| 12 | `Sad` | ✅ | 3 s | Slumped, tail dragging, sigh  **OPTIONAL — skip for now** |
| 13 | `Excited` | ✅ | 1 s | Hopping, rapid tail slaps  **OPTIONAL — skip for now** |
| 14 | `Think` | ✅ | 2 s | Taps chin, looks up, tail curls  **OPTIONAL — skip for now** |
| 15 | `Handoff` | ❌ | 1.2 s | Holds out a paper/log with both paws, nod  **OPTIONAL — skip for now** |
| 16 | `Sniff` | ✅ | 2 s | Nose to the ground, moving side to side, whiskers twitching  **OPTIONAL — skip for now** |
| **Tier 3 — sleep** | | | | | |
| 17 | `Yawn` | ❌ | 1.5 s | Big toothy yawn, stretch  **OPTIONAL — skip for now** |
| 18 | `Sleep` | ✅ | 4 s | Curled, tail as a blanket, slow breathing  **OPTIONAL — skip for now** |
| 19 | `SleepWalk` | ✅ | 1.2 s | Drowsy waddle, eyes half-closed  **OPTIONAL — skip for now** |
| 20 | `WakeUp` | ❌ | 1.2 s | Startles awake, shakes head  **OPTIONAL — skip for now** |
| **Tier 4** | | | | | |
| 21 | `Greet` | ❌ | 1.5 s | Waves a paw, tail slap  **OPTIONAL — skip for now** |

**Optional shape keys** (head mesh): `MouthOpen` (lip-sync), `Blink`.
**Don't make:** talking-while-scared variants or color changes (code does those).

## Mood → clip

| Mood | Resting clip | Entry one-shot |
|---|---|---|
| neutral | `Idle` | — |
| happy | `Idle` | `Happy` |
| excited | `Excited` | `Happy` |
| nervous | `Nervous` | — |
| scared | `Scared` | — |
| sad | `Sad` | — |
| sleepy | `Sleep` | `Yawn` |

## Order and time (Archie only)

| Step | Work | Time |
|---|---|---|
| 1 | Model + rig (tail paddle, jaw/teeth, props) | ~60 min |
| 2 | Tier 1 core: `Idle`, `Walk`, `Talk`, `Work`, `Happy`, `Scared` | ~60 min |
| 3 | `Carry`, `TailSlap`, `Read`, `HoldNote` | ~40 min |
| 4 | Check + export (`tools/blender/check_character.py`, `export_character.py`) → push | ~10 min |
| 5 | Tier 2 | ~45 min |
| 6 | Tier 3 | ~30 min |
| 7 | Tier 4 | ~10 min |

**Total ≈ 4–4.5 h.** Do steps 1–4 first. Everything else has code fallbacks.

> **Delete = soft trash (approved):** when Archie "deletes", play `Carry` toward the screen edge (hauling files to ADE Trash). Undo = `Carry` back in. No extra clip needed.
