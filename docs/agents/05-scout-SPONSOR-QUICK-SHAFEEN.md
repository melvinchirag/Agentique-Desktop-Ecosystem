# Scout (eagle) — Quick Sponsor Plan for Shafeen (~45 min)

**Scout** = id `eagle`, web research with sources. Logic is being built on `eagle/logic` (Backboard `web_search: 'Auto'`, tools `web_open` + `web_save_brief`).
**Branch:** `eagle/sponsors` (from latest `main`). Keep it small. Codex only.

## What already exists (don't redo)
- ✅ Backboard assistant `BB_ASSISTANT_EAGLE` (created + verified live in PR #19, web search passes)
- ✅ Voice `EL_VOICE_EAGLE`
- ✅ SFX in `resources/sfx/eagle/`: screech, wing-flaps, whoosh (+ poke), already wired in the app
- ✅ Tiger table `research_log` in `scripts/tiger-schema.sql`

## Do (3 small lanes, all Codex)

| # | Task | Model | Owned paths |
|---|---|---|---|
| E1 | **Scout's memory rules.** Update the existing eagle assistant's `custom_fact_extraction_prompt` / `custom_update_memory_prompt` (Backboard update endpoint, or `create-assistants.ts --only eagle --force` if it supports it; never create a duplicate). Remember: interests, location context (EMU, Ypsilanti), budget habits, trusted/untrusted sources. Never: raw web page text, anything inside `<untrusted>`. | GPT-6 Luna, medium | `scripts/*eagle*`, `src/main/agents/eagle/memory-rules.ts` (text only) |
| E2 | **Tiger research log store.** `src/main/store/tigerResearch.ts`: `append({ title, sources: string[], briefPath? })`, `recent(limit)`, `search(q, sinceHours)` over `research_log`, with an in-memory fallback when Tiger is offline (same pattern as the other Tiger stores). Export a small `ResearchLog` interface from that file (no shared-contract edits). Tests with a fake pg client. | GPT-6 Sol, medium | `src/main/store/tigerResearch.ts`, `tests/tigerResearch.test.ts` |
| E3 | **Scout lines + verify.** Pre-generate Scout's 6 template lines with `EL_VOICE_EAGLE` into the voice cache list (`"Scout, fly! We need intel!"`, `"Eyes on target."`, `"Found three solid sources!"`, `"Nothing reliable out there."`, `"Brief saved to your Research folder."`, `"Back on my perch."`). Run `scripts/backboard-verify.ts` for eagle only (web search answer + a source URL). Record results in `docs/scout-sponsors-verify.md`. | GPT-6 Luna, medium | `scripts/*voice*` (eagle lines only), `docs/scout-sponsors-verify.md` |

Then: `npx tsc --noEmit`, `npm test`, commit `eagle(sponsors): memory rules, research log store, lines`, push `eagle/sponsors`, open PR → main.

## Graphics (Shafeen is already making the model)
Required clips for `eagle`: **Idle** (perched), **Fly** (loop), **Talk**, **Happy**, **Takeoff**, **Land**. Static model first → push → then clips one at a time. Export to `src/renderer/public/characters/eagle/default/model.glb`, ~0.7 m perched, origin at feet, faces −Y. Branch `eagle/graphics`.
