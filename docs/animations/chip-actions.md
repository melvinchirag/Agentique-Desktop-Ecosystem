# Chip (Chipmunk) — Animation Actions for Zarin

Every row below is one **Blender Action**. Name it **exactly** as written (case-sensitive), because the app plays clips by name.
General export rules are in `../ASSETS.md §2`. The short version:
- `.glb`, +Y up, faces −Y, origin at the feet, about 0.35 m tall
- 30 fps, **in place** (no root motion; the code moves Chip around the biome)
- Every Action has **Fake User** on
- Looping clips: the first frame = the last frame

**Colors are done in code.** Don't animate tints: blue-when-scared, glow-when-happy, and so on are added by the app.

---

## 1. Chipmunk body language cheat sheet (use for every emotion)

| Emotion | Ears | Tail | Posture | Eyes / face | Paws |
|---|---|---|---|---|---|
| Neutral | Up, relaxed | Gentle S-curve, slow sway | Upright, slight lean forward | Open, blinking | Together at chest |
| Happy | Perked up | Fluffy, high, quick flicks | Bouncy, chest out | Squinty smile | Little claps or pumps |
| Excited | Straight up | Wild fast wagging | Can't stand still, bouncing | Wide, sparkly | Waving, fists up |
| Nervous | Half back, twitching | Low, flicking nervously | Slightly hunched | Darting side to side | Wringing / fidgeting |
| Scared | **Flat back** | **Puffed up**, tucked around body | Crouched low, small | Huge, wide | Covering mouth or hugging tail |
| Sad | Drooped sideways | Dragging on the ground | Slumped, head down | Half-closed, looking down | Hanging limp |
| Sleepy | Folded down | Wrapped around body like a blanket | Curled ball | Closed | Tucked under chin |

---

## 2. The Action list

### Tier 1 — make first (the demo needs these)

| # | Action name | Loop | Length | What it looks like | When the app plays it |
|---|---|---|---|---|---|
| 1 | `Idle` | ✅ | 3 s | Neutral breathing, a look left and right, one tail sway, a cheek twitch | Default resting state |
| 2 | `Talk` | ✅ | 1.5 s | Head bobs, paws gesture, tail flicks on emphasis. Mouth flaps (or uses the `MouthOpen` shape key, §3). | Whenever Chip is speaking |
| 3 | `Run` | ✅ | 0.6 s cycle | Fast scamper on all fours, tail streaming behind | Running across the desktop to another animal to hand over a task |
| 4 | `Handoff` | ❌ | 1.2 s | Holds a little scroll out with both paws, pushes it forward, small nod | Giving a task to another animal |
| 5 | `Happy` | ❌ | 1.2 s | Happy hop, quick spin, tail fluff, lands with a grin | A task finishes, or the user is happy |
| 6 | `Scared` | ✅ | 1.5 s | **The signature emotion.** Ears flat, tail puffed and hugged, crouched and trembling, eyes darting | The user is angry (the app also turns Chip blue) |
| 7 | `Listen` | ✅ | 2 s | Ears shoot up and point forward, leans toward the camera, head tilts, attentive | The user is holding Chip to talk (or the Hub mic) |
| 8 | `Think` | ✅ | 2 s | Paw on chin, eyes look up, taps foot, tail curls into a question mark | Waiting on the AI |

### Tier 2 — emotions (the "biome reacts" system)

| # | Action name | Loop | Length | What it looks like | When |
|---|---|---|---|---|---|
| 9 | `Nervous` | ✅ | 2 s | Fidgeting paws, glances side to side, ears twitching half-back, small shifts in weight | The user is stressed |
| 10 | `Sad` | ✅ | 3 s | Slumped, ears drooping, tail dragging, slow sigh (shoulders rise and fall) | The user is sad, or a task failed |
| 11 | `Excited` | ✅ | 1 s | Rapid little bounces in place, tail wagging wildly, paws pumping | The user is excited |
| 12 | `Relief` | ❌ | 1.5 s | Big exhale (body deflates), wipes forehead with a paw, then a small happy hop | The user calms down after being angry/stressed |
| 13 | `Celebrate` | ❌ | 2 s | Bigger than Happy: jumps, backflip or spin, arms up, confetti pose at the end | Good news on a nudge ("my exam went great!") |

### Tier 3 — sleep and wake (every animal has these)

| # | Action name | Loop | Length | What it looks like | When |
|---|---|---|---|---|---|
| 14 | `Yawn` | ❌ | 1.5 s | Huge yawn, stretches arms up, eyes droop | Starting to fall asleep (idle timeout 1) |
| 15 | `Sleep` | ✅ | 4 s | Curled in a ball, tail wrapped over like a blanket, slow breathing, an ear twitch now and then | Asleep (Chip sleeps but never docks) |
| 16 | `WakeUp` | ❌ | 1.2 s | Eyes pop open, ears spring up, shakes head, quick stretch | Waking up when the user clicks Chip or types, or a nudge fires |

### Tier 4 — personality and push-first

| # | Action name | Loop | Length | What it looks like | When |
|---|---|---|---|---|---|
| 17 | `Greet` | ❌ | 1.5 s | Stands tall, big wave with one paw, tail swish | App startup |
| 18 | `Nudge` | ❌ | 2 s | **Push-first moment.** Hops toward the camera, taps on the "glass" with a paw (like knocking on the screen), tilts head as if asking a question | Chip asks the user something unprompted ("How did your exam go?") |
| 19 | `Dizzy` | ❌ | 1.5 s | Shakes head, wobbles, eyes spin (or the head circles), sits down for a second | Chip's AI fails ("My brain's a bit foggy…") |
| 20 | `Walk` | ✅ | 1 s cycle | Normal hop-walk on all fours, calmer than Run | Moving around the biome casually |

---

## 3. Face shape keys (optional, high payoff)

Shape keys on the head mesh. Exact names:

| Shape key | Range | What it does | Driven by |
|---|---|---|---|
| `MouthOpen` | 0 → 1 | Jaw/mouth open | **The app syncs it to the ElevenLabs voice volume**, so Chip lip-syncs |
| `Blink` | 0 → 1 | Both eyes closed | The app blinks Chip randomly every 2–6 s |
| `Smile` *(nice to have)* | 0 → 1 | Cheeks up, mouth corners up | Happy / Excited moods |
| `Worried` *(nice to have)* | 0 → 1 | Brows up in the middle, mouth small | Nervous / Scared moods |

If shape keys aren't possible, animate the mouth inside `Talk` instead. Lip-sync is a bonus.

---

## 4. How the app combines them (so Zarin knows what *not* to make)

- **One clip at a time**, with a 0.25 s crossfade between clips.
- **Emotion loops replace `Idle`** while Chip is resting in that mood (e.g. resting while the user is angry → `Scared`).
- **Talking always uses `Talk`.** The app layers the mood on top with color tint, a code-driven tremble when scared, and the `Smile`/`Worried` shape keys. **No need for `TalkScared` / `TalkHappy` variants.**
- **One-shot clips** (`Happy`, `Handoff`, `Relief`, `Celebrate`, `Yawn`, `WakeUp`, `Greet`, `Nudge`, `Dizzy`) play once, then return to whatever loop fits the current state.
- **Missing clip** → the app uses a code-driven fallback (hop, bob, tremble), so nothing breaks while you work.

### Mood → clip map (for reference)

| Chip's mood | Resting clip | Entry one-shot |
|---|---|---|
| neutral | `Idle` | — |
| happy | `Idle` | `Happy` (or `Celebrate` when the user is very happy, intensity ≥ 0.8) |
| excited | `Excited` | `Happy` |
| nervous | `Nervous` | — |
| scared | `Scared` | — |
| sad | `Sad` | — |
| relieved | `Idle` | `Relief` |
| sleepy | `Sleep` | `Yawn` |

---

## 5. Suggested order and time (Chip only)

| Order | Actions | Rough time |
|---|---|---|
| 1 | Rig check: ears, tail (4–6 bones for nice curls), paws, jaw | 20–30 min |
| 2 | `Idle`, `Talk`, `Scared`, `Happy` | ~60 min |
| 3 | `Run`, `Handoff`, `Listen`, `Think` | ~45 min |
| 4 | Export → test in the Asset Lab (Ctrl+Shift+A in the app) | 10 min |
| 5 | `Nervous`, `Sad`, `Excited`, `Relief`, `Celebrate` | ~50 min |
| 6 | `Yawn`, `Sleep`, `WakeUp` | ~30 min |
| 7 | `Greet`, `Nudge`, `Dizzy`, `Walk` | ~40 min |
| 8 | Shape keys `MouthOpen`, `Blink` (then `Smile`, `Worried`) | ~30 min |

**Total about 4.5–5 hours for Chip alone.** The other animals also need their core clips, so after step 4, consider switching to Warden's core set and coming back to Chip's Tier 2–4 later.
