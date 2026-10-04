# Lane L4 — AnimationDirector, layout, choreography (Codex GPT-6 Sol, high)

Read `docs/lanes/APP-COMMON.md` first.

## Objective
Turn the `BiomeEvent` stream into choreography on the desktop: the desktop layout math, a per-agent state
machine with an action queue (no overlapping moves), every row of the spec §7 table, sleep/dock/wake,
Scout's fly-off, the ant carrier, help-walks, and Replay at 2×. You drive mocks of the other lanes.

## Owned paths
- `src/renderer/overlay/director/**`
- `src/renderer/overlay/layout.ts`, `src/renderer/overlay/layout.test.ts`

## Spec to read
`00-APP-SHELL-SPEC.md` §5, §7, §8 (priority), §10, §12; `DECISIONS.md` §5, §6, §7; `ASSETS.md` §3;
`animations/chip-actions.md`. Contracts: `ComputeLayout`, `DesktopLayout`, `CharacterLayer`, `SpeechQueue`,
`SfxPlayer`, `OverlayUi`, `DirectorDeps`, `AnimationDirector`, `CreateAnimationDirector` in
`src/renderer/shell/contracts.ts`; `DisplayLayout`, `EventPlayer` in `src/main/shell/contracts.ts`.

## Clip names you may use (exact; CharacterLayer falls back procedurally if missing)
Everyone: Idle, Walk, Talk, Work, Happy, Scared, Think, Sad, Sleep, Greet, Yawn, SleepWalk, Excited, Nervous,
WakeUp. Chip: Listen, Run, Handoff, Dizzy, Celebrate, Relief, Nudge, TalkHappy, TalkScared, Worried.
Warden (`wolf`): Guard, Growl, Block, Howl, Sit. Scout (`eagle`): Fly, Glide, Land, Takeoff, Perch.
Archie (`beaver`): Carry, TailSlap. Pixel (`workspace`): Write, Handoff.

## Steps
1. **`layout.ts`**: `computeLayout: ComputeLayout`. Overlay size = work-area size; `groundY = height − 4`.
   Home x by percentage of width: ants 6 %, beaver 16 %, workspace 26 %, chipmunk 38 %, wolf 50 %,
   eagle 60 %, butterfly 70 %, nightingale 78 %. `colonyX = spots.ants`, `centerX = width / 2`.
   `hubX` = Hub center x in overlay-local coords (`hubBounds.x − workArea.x + hubBounds.width / 2`), clamped
   to [0, width]. `dockPoint = { x: hubX, y: hubBounds.y − workArea.y + 28 }`, clamped inside the overlay.
2. **Director** (`director/index.ts` exports `createAnimationDirector`; split internals as you like):
   - Per-agent **action queue**: each agent's actions run strictly in order (promise chain). An action that
     involves two agents (Chip running to a target) holds both queues. Track per agent: presence, status,
     mood, docked, away (flown off), home x.
   - **Rows of spec §7** (overlay column). Exact behavior:
     - `user.message` → Chip `Listen` once → `Think` loop.
     - `agent.status`: thinking → `Think`; working → `Work` loop + `ui.showBubble(id, detail, 'status')`
       when `detail`; away → `layer.flyOff` (Scout); speaking → `Talk`; waiting_approval → `Sit` (if wolf)
       else Idle, + `'…'` bubble kind `waiting`; error → `Dizzy` (Chip) / `Sad`; idle/done → clear the
       status bubble, back to `Idle`; listening → `Listen`. An away animal coming back to idle/done →
       `layer.flyIn(home)`.
     - `agent.mood` → `layer.setMood`; loops: scared `Scared` (Chip speaking scared → `TalkScared`), nervous
       `Nervous`, sad `Sad`, excited `Excited`; happy → `Happy` once (intensity ≥ 0.8 → `Celebrate`, Chip
       only; others `Happy`); relieved → `Relief` once (Chip) / `Happy`; neutral → back to the status loop.
     - `agent.handoff` (from Chip): Chip `setProp('scroll')` → `moveTo(target home − 60 px toward Chip,
       run)` → face target → `Handoff` once → scroll moves to the target (`setProp` null on Chip, scroll on
       target briefly) → Chip runs home. **`via: 'ants'`** → instead `layer.antCarrier(colonyX, targetX)`.
       A docked target → `undock(home)` first; an away target is left alone.
     - **Help job** (`job.update` state running with `requestedBy` ≠ `chipmunk`): the asker walks to the
       helper, waits ~1 s, walks home.
     - `agent.return` → the returning agent faces Chip; Chip `Happy` once.
     - `agent.say` → `ui.showBubble(id, bubble, 'say')` + `speech.enqueue({ agentId, text, mood: current
       mood, priority })`; the speaker plays `Talk` (Chip: `TalkHappy`/`TalkScared` by mood) between
       `speech.onStart` and `speech.onEnd` for that item, then returns to its loop.
     - `agent.recall` → `ui.sparkle(id)`.
     - `agent.presence`: startup/active (not docked) → `spawn(home)` + `Greet` once; sleeping → `Yawn`
       once → `Sleep` loop + mood `sleepy`; docked → `moveTo(hubX, sleepwalk)` → `dockInto(dockPoint)`
       (**Chip never docks**: ignore docked for chipmunk); active from docked → `undock(home)`
       (Scout: `flyIn(home)`); active from sleeping → `WakeUp` once → `Idle`; not_installed → `despawn`.
     - `nudge.fire` → Chip `WakeUp` if asleep → `moveTo(centerX)` → `Nudge` once + `sfx.play('knock')` →
       after ~3 s walk home.
     - `tool.request` with risk write/destructive/external → Warden faces the agent + `Guard` once.
     - `wolf.verdict` ask → Warden walks next to the agent, `Sit`; deny → Warden `moveTo(agent x, run)`,
       `Block` once, `sfx.play('growl')`, mood protective, then home after ~2 s; allow → nothing.
     - `wolf.alert` → Warden `Howl` once + `ui.showBubble('wolf', short reason, 'warning')`.
     - `approval.request` → `ui.showApproval({ callId, title, preview, nearAgent: 'wolf' })`;
       `approval.resolve` → `ui.closeApproval(callId)`, Warden home.
     - `tool.result` → `ui.puff(agentId, ok)`.
     - `artifact` → `ui.flyToHub(agentId, title)`.
     - `job.update` otherwise → no overlay action (the Hub shows it).
   - **Replay**: `replay(taskId)` → `getTaskEvents`; empty → resolve. Else `ui.setReplayBanner(true)`,
     `createPlayer()`, `load(events → { atMs: e.ts − first.ts, event })`, `setSpeed(2)`, play through the
     same handlers. Live events arriving meanwhile are queued and handled, in order, after the replay ends
     or `stopReplay()`; banner off at the end.
   - `setLayout` → new homes; idle grounded animals walk to their new home; dock point updates.
   - `dispose` → unsubscribe speech listeners, stop timers, stop any replay.
3. Timing waits (e.g. "~1 s", "~3 s") use the injected `Clock`.

## Tests you must add (mocks only)
A mock `CharacterLayer` that records every call with a timestamp and resolves promises on demand; mock
`SpeechQueue` (exposes `fireStart/fireEnd`), `OverlayUi`, `SfxPlayer`, `EventPlayer`; fake clock.
One test per §7 row above; per-agent serialization (a second move waits for the first); handoff holds both
agents; docked target undocks before the handoff; Chip never docks; Scout away → flyOff, done → flyIn;
replay queues live events and flushes them in order; `layout.ts` at 100/125/150 % (1920×1040 @1,
1536×816 @1.25, 1280×680 @1.5) incl. a dragged and a collapsed Hub.

## Lane-specific STOP conditions
- A §7 row needs a `CharacterLayer`/`OverlayUi`/`SpeechQueue` capability the contract lacks.
