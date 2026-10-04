# Pixel (Workspace) — Animation Actions for Zarin ✅ APPROVED (Oct 4)

Graphics must be fast (Chanuth, Oct 4): **only 6 clips are required.** Everything else is done procedurally in code by the app shell.
Same rules as Chip, Archie, Warden (`chip-actions.md`, `../ASSETS.md §2`): exact Action names, Fake User on, in place, 30 fps, loops seamless, no color animation.
- `.glb` ≈ 0.7 m tall, faces −Y, origin at the base. Saved to `src/renderer/public/characters/workspace/default/model.glb`
- Blender source: `art/workspace/workspace.blend` · Branch: `pixel/graphics`

## Character design brief (Zarin decides the form)
- **Pixel is a custom character, not an animal** (robot, living envelope, paper creature, sprite: your call). Accent color `#7A6A9E` (purple).
- Must read at about 70–90 px tall next to the animals: bold silhouette, big hands, high contrast on any desktop.
- Needs **two hands that can hold a letter/envelope and a pen**, and a face area for eyes and a mouth (`MouthOpen`, `Blink` shape keys if you have time).
- Personality: crisp, clever, upbeat, tidy, a little techy. If it floats, still make `Walk` (a hover-glide) and keep the base at the origin.
- Small separate props on a hand bone: `Prop_Letter`, `Prop_Pen` (optional `Prop_Stamp`).
- Post 2–3 concept images to Chanuth first; he picks one before you rig (about 15 min).

## The 6 required clips

| # | Name | Loop | Length | Looks like | When |
|---|---|---|---|---|---|
| 1 | `Idle` | ✅ | 3 s | Breathing/bobbing, a look around, a blink | Default |
| 2 | `Walk` | ✅ | 1 s | Walk or hover-glide, in place | Moving along the taskbar |
| 3 | `Talk` | ✅ | 1.5 s | Head bobs, small hand gestures, mouth moves | Speaking |
| 4 | `Happy` | ❌ | 1.2 s | Hop/bounce with a little spin and a grin | Job done, user happy |
| 5 | `Write` | ✅ | 2 s | **Signature.** Writes on a letter with the pen (`Prop_Letter`, `Prop_Pen`) | Any Google work: reading, sorting, drafting (the app maps `Work` → `Write`) |
| 6 | `Handoff` | ❌ | 1.2 s | Holds the envelope out with both hands, small nod | Giving a file/draft to Chip or Archie |

`character.json` (Zarin's Codex writes it): `"clipMap": { "Work": "Write" }`. If the character floats and you named the move `Fly`, add `"Walk": "Fly"`.

## Code handles these (do NOT animate them)
The app shell builds them procedurally (squash, bob, tilt, tint, "z"):
`Scared`, `Nervous`, `Sad`, `Excited`, `Think`, `Relief`, `Celebrate`, `Sleep`, `Yawn`, `SleepWalk`, `WakeUp`, `Greet`, plus the Pixel moments **stamp press** (draft ready), **reading**, **holding up the envelope**, and **receiving a scroll**. Moods are tints and posture in code, not clips.

## Body language (so the procedural moods fit)

| Mood | Posture | Face |
|---|---|---|
| Neutral | Upright, relaxed | Calm, blinking |
| Happy / excited | Bouncy, quick small hops | Wide eyes, grin |
| Nervous (user stressed, waiting for Warden) | Hunched, still | Eyes glancing sideways |
| Sleepy | Slumped, leaning on its base | Eyes half closed |

## Mood → clip (for reference)

| Mood / event | What plays |
|---|---|
| neutral | `Idle` |
| happy, excited, proud, relieved | `Idle` + `Happy` one-shot |
| nervous, scared, sad, sleepy | `Idle` + code posture and tint |
| working (any tool) | `Write` (via `clipMap`) |
| speaking | `Talk` |
| handing a task result to Chip/Archie | `Handoff` |

## Order and time (Pixel only)

| Step | Work | Time |
|---|---|---|
| 1 | Concept images → Chanuth picks one | ~15 min |
| 2 | Model + rig (hands, face, 2 props) | ~75 min |
| 3 | `Idle`, `Walk`, `Talk`, `Happy`, `Write`, `Handoff` | ~60 min |
| 4 | Check + export (`tools/blender/check_character.py`, `export_character.py`) → push | ~10 min |

**Total ≈ 2.7 h.** Nothing else is needed.
