# Swarm (ants) — Quick Sponsor + Graphics Plan for Shafeen

**Swarm** = id `ants`, the planner. Logic is being built on `ants/logic` (numbered plan → Chip delegates each step; an ant carries each step).
Codex only. Keep it small.

## Already exists (don't redo)
✅ Backboard assistant `BB_ASSISTANT_ANTS` · ✅ voice `EL_VOICE_ANTS` (the app adds the chorus effect) · ✅ SFX `resources/sfx/ants/` (skitter, marching-patter, poke) · ✅ Tiger table `plan_items`

## Sponsors — branch `ants/sponsors` (~40 min)
| # | Task | Model | Owned paths |
|---|---|---|---|
| W1 | **Memory rules** for the existing ants assistant (update, never duplicate): remember work habits (best focus hours, block length), goals, typical task durations. Never: email/file/web content. | GPT-6 Luna, medium | `scripts/*ants*`, `src/main/agents/ants/memory-rules.ts` (text only) |
| W2 | **Tiger plan store** `src/main/store/tigerPlans.ts`: `savePlan(goal, steps[])`, `markStep(id, status)`, `today()`, `completionToday()` → "3 of 4 done" for Chip's evening wrap-up; in-memory fallback when Tiger is offline. Export a small `PlanStore` interface from the file (no shared-contract edits). Tests with a fake pg client. | GPT-6 Sol, medium | `src/main/store/tigerPlans.ts`, `tests/tigerPlans.test.ts` |
| W3 | **Swarm lines** pre-generated with `EL_VOICE_ANTS`: "Swarm, assemble!", "Plan assembled!", "Step one, on its way!", "All steps delivered!", "We need a clearer goal.", "Back to the colony!" | GPT-6 Luna, medium | `scripts/*voice*` (ants lines only) |
Then `npx tsc --noEmit`, `npm test`, commit `ants(sponsors): memory rules, plan store, lines`, push, PR → main.

## Graphics — branch `ants/graphics` (~1–1.5 h)
**ONE ant** (the app copies it into a swarm of 12). Low-poly, cute, red-brown `#A23B2A`, ~0.08 m tall, origin at feet, faces −Y, < 3k triangles (it's instanced 12×).
Required clips (exact names): **Idle**, **Walk** (fast loop), **Carry** (walking while holding a leaf/scroll above its head, loop), **Happy**, **Talk**.
Static model first → `src/renderer/public/characters/ants/default/model.glb` → check → push → then clips one at a time (check + export + push after each). Blender source: `art/ants/ant.blend`.
