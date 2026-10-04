# ADE — Decision Log (everything agreed, in one place)

**Read this first.** Every decision made while planning ADE is here, newest at the bottom of each section.
Detailed specs live in the linked files. If a detail file disagrees with this log, **this log wins** until the detail file is fixed.
Owner of this file: Chanuth (with Claude). Last updated: Sun Oct 4, 2026, early morning.

---

## 1. Event and targets
- **Event:** Hack Dearborn 5 "Conjure Reality", UM-Dearborn, Oct 3–4, 2026. Hacking ends **Sun 12:00 PM** (Devpost deadline). Demo setup 1:00 PM, judging 1:30–3:00 PM, 5-minute science-fair demo, slides strongly recommended, track selection required.
- **Team:** Chanuth, Melvin, Shafeen, Zarin. (They won the event's CTF.)
- **Devpost:** project created ✅.
- **Main track:** **Ideation Matrix** (not Shaping Society; its wording favors healthcare/food/etc. projects).
- **Sponsor track:** **VentureWell Innovation** (open to any track; judged on originality, meaningful problem, prototype quality, real-world impact; prize AirPods 4).
- **MLH challenges:** **Backboard, ElevenLabs, Tiger Data** only, each used deeply.
- **Not entering:** Gemini (users bring their own AI instead), Solana (clashes with "easy for non-technical users"; verified-agent registry is a roadmap slide), Vultr.
- **Judging rubric** (1–5 each): Implementing Technology, Overall Design, Quality of Solution, Team Presentation, Track/Concept ("2–4 unique features, fits the track in multiple ways").

## 2. Product
- **ADE = Agentique Desktop Ecosystem** (repo: github.com/melvinchirag/Agentique-Desktop-Ecosystem). A downloadable Windows `.exe` where AI agents are animated, rigged 3D animals that **live directly on the real Windows desktop**: a transparent, click-through, always-on-top overlay over your normal apps. **There is no app window.** The **Agent Hub** (small draggable box) is the only app-like UI. Non-technical users connect their own AI and just talk to Chip.
- **Not a hybrid and not a window:** no biome strip, no windowed world. A window "loses the purpose". The animals are on the desktop.
- **Biome visuals are deferred.** The animals live on the plain desktop for now. Biomes/skins come later as theme packs (same agents, new look).
- **Pitch core:** agents are powerful but only technical people can use them; ADE makes them visible, safe, and fun. "Trust through visibility": you watch the animals work.
- **Terminology:** it's a **biome** (forest is the first biome). Use "the biome reacts", `biome_history`, `BiomeEvent`, `biome_events`. Never "forest" in identifiers.
- **Biomes and skins:** forest ships first. Desert, snow, etc. and character skins are drop-in asset packs later (`biomes/<id>/`, `characters/<agent>/<skin>/`).
- **Marketplace (designed later):** all agents, community-shared agents, skins, biomes. Opened by clicking the Agent Hub. Roadmap: share an agent = clone its Backboard assistant config; a verified-agent registry.
- **Safety promise:** ADE **never sends email, posts, buys, or permanently deletes.** No such tools exist, and Warden denies the whole category.

## 3. Stack
- **Electron + electron-vite + React + TypeScript + React Three Fiber (drei)**, packaged with **electron-builder (NSIS) → .exe**. (Melvin's early `concept.md` said Tauri + koi-pond; superseded.)
- **Desktop overlay:** transparent, frameless, always-on-top window covering the screen; mouse clicks pass through to the apps underneath except over an animal, a bubble, or the Agent Hub. Exact mechanics → the app shell plan (written later).
- **All AI reasoning goes through Backboard** with the user's chosen provider/model per animal. No direct model APIs.
- Secrets only in the Electron main process (`.env` in dev, `safeStorage` packaged). Never in the renderer or git.

## 4. Animals (names locked)

| Id | Name | Animal | Job | Tier |
|---|---|---|---|---|
| `chipmunk` | **Chip** | Chipmunk | Orchestrator (the one you talk to) | Core |
| `workspace` | **Pixel** | Custom character (Zarin designs) | Google Workspace: Gmail, Calendar, Drive, Docs, Sheets | Core |
| `wolf` | **Warden** | Wolf | Security: checks every action, approvals, audit, prompt-injection guard | Core |
| `beaver` | **Archie** | Beaver | Files | Core |
| `eagle` | **Scout** | Eagle | Web research / browsing | Core |
| `ants` | **Swarm** | Ants | Planning (day plans, goals → steps → calendar blocks) | Core |
| `butterfly` | **Iris** | Butterfly | Social post drafts (never posts) | Extra |
| `nightingale` | **Celene** (after Céline Dion) | Nightingale | Mood music | Extra |

## 5. How the biome works
- **Hybrid communication:** Chip controls everything through one JobScheduler (hub-and-spoke). Animals can **ask each other for help directly** (`ask_teammate`, one level deep). Everyone **talks out loud**.
- **Help jobs** skip the helper's queue and run alongside its own job (no deadlocks) ✅.
- **Parallel jobs:** different animals work at the same time. The same animal does one job at a time (FIFO). Duplicates are ignored. "Stop" cancels everything; "stop Scout" cancels only Scout.
- **Non-blocking delegation:** Chip hands off and is free immediately; results come back as new Chip turns. Chains use `next_step`.
- **Clarifying questions:** Chip is interactive and asks one short question when anything important is unclear.
- **You only ever talk to Chip** ✅. Other animals never take direct conversation.
- **Clicking another animal** → its **inspect card** (what it's doing, its queue, wake/sleep, its memories), not a chat. ✅
- **How you talk to Chip:** no global hotkeys. **Click-and-hold Chip to speak** (or the Hub's mic button), and type in the Hub's chat box. ✅
- **Multi-step goals:** Chip asks **Swarm for the plan first**, then delegates each step itself. **Swarm never hands out work.** Each step is shown as **one ant walking from Swarm's colony to the animal doing that step**, carrying the task ✅.
- **Keyboard shortcuts:** **deferred** (too much testing tonight) ✅.
- **Talking files** (Melvin's "object agents"): Archie reads a desktop file and the file "speaks" a one-line summary. Low priority ✅.
- **Voices for every animal + bubbles:** every spoken line has a 1–2 word bubble (optional emoji) above the head; the full meaning is spoken. Speech priority: Warden > Chip > specialist report > ack. Chip and Warden lines are never dropped.
- **Specialists report** in one ~10-word spoken line before Chip summarizes ✅.
- **Scout flies off-screen** while browsing and flies back with the result.

## 6. Sleep, dock, and the Agent Hub
- **Two timeouts:**
  1. idle → **asleep in place** (yawn, curl up, "z z z")
  2. asleep long enough → **sleep-walks to the Agent Hub and docks** (off)
- **Timers:** 3 min / 10 min (demo mode 30 s / 60 s) ✅. Mood calm-down: 20 s.
- **Auto-wake:** giving a docked animal a job brings it back automatically ✅.
- **Chip sleeps but never docks** ✅.
- **Agent Hub:** a small **draggable** box (top-right by default) with:
  - **status bar** rows per animal (saved to Tiger)
  - **Agents ▾** dropdown to wake docked animals (Scout flies back, others walk)
  - do-not-disturb toggle
  - **click it → Marketplace / Agent Workspace**
  - tabs: Memories, Pulse, Warden Audit

## 7. Mood system ("the biome reacts")
- Chip reads the user's mood every turn (words + voice cues like sighs and laughs).
- Chip reacts first; the other **active** animals catch it 400 ms later, 250 ms apart; everyone calms down after 20 s.
- Angry user → Chip **scared (turns blue)**, Warden **protective**, the rest scared or nervous.
- **Relief** after anger → Chip relieved, Warden proud, others happy. Very happy → Celebrate.
- Full table: `agents/01-chip-orchestrator.md §15`.

## 8. Push-first Chip (must-have)
- Chip reaches out on its own:
  - before and after important calendar events
  - follow-ups on things you mention (`schedule_followup`)
  - **daily check-in** (first open after 8 AM)
  - **evening wrap-up** (8 PM)
  - **weekly** (Sunday 6 PM)
  - waiting-drafts reminders
- **Manners:** quiet hours 11 PM–8 AM, do-not-disturb, never interrupts, max 3 per hour (merged), "later" snoozes 2 h ✅.
- **Demo hotkey:** Ctrl+Shift+N fires the next nudge.

## 9. Sponsors (all approved ✅ — full plan `SPONSORS.md`)
- **Google Workspace APIs** (Gmail, Calendar, Drive, Docs, Sheets) are also used, for Pixel. They're required, not an MLH sponsor.
- **Backboard = brains + memory:**
  - one assistant per animal, each with **its own memory rules** (custom extraction/update prompts)
  - memory mode by call type (Chip: user turn Auto, result/nudge turns Readonly, planner off)
  - user's own model per animal
  - tools, built-in web search (Scout), JSON output, documents (job threads only)
  - Memory screen with search/edit/delete
  - 💭 recall sparkle (`agent.recall` event)
  - **Warden has memory OFF on purpose** ✅
- **ElevenLabs = voice + sound:**
  - 8 **original Voice Design voices** (no cloning)
  - `eleven_v4_turbo` with **mood audio tags**; `scribe_v2` STT with audio-event tags
  - timestamps for lip-sync
  - ~35 sound effects + biome ambience
  - **Swarm = chorus effect** ✅
  - **Celene composes music with ElevenLabs Music** if the plan allows ✅
  - pre-generated acks, caching, voice-off dev switch
- **Tiger Data = time + history:**
  - `biome_events` hypertable with compression (7 d) + retention (90 d)
  - continuous aggregates (`agent_activity_5m`, `mood_daily`, `job_stats_daily`)
  - views (`wolf_audit`, `job_history`, `user_mood_timeline`)
  - tables (`nudges`, `file_ops`, `plan_items`, `drafts_log`, `research_log`)
  - powers Biome Replay, Warden Audit, Biome Pulse, `biome_history`, nudges, Archie's undo after restart, evening wrap-up, waiting-drafts nudge
- **Contract changes approved ✅:**
  - `agent.recall` event
  - `AdeApi.searchMemories / updateMemory / getPulse / getWardenAudit`
  - the new Tiger tables and aggregates
  - `EL_VOICE_ANTS`, `EL_VOICE_NIGHTINGALE`

## 10. 3D + animation (Zarin)
- **Every animal is rigged in Blender.** Drag-and-drop pipeline: export `.glb` → drop into `characters/<agent>/default/` → it works. Procedural fallback for anything missing. Asset Lab (Ctrl+Shift+A) shows found/missing clips.
- **Exact clip names** (`ASSETS.md`):
  - core 6 for every animal: Idle, Walk, Talk, Work, Happy, Scared
  - then Sleep, Yawn, SleepWalk (not Chip), plus signature clips
- **Chip's full list (20 actions + face shape keys):** `animations/chip-actions.md` and **`animations/Chip_Animations_for_Zarin.txt` (sent to Zarin ✅)**.
- Colors and mood tints are done in code, never animated.

## 11. Chip spec
- **Final: v3.1** (`agents/01-chip-orchestrator.md`), verified (18 fixes).
- Built as a **standalone module** (plain TypeScript, no Electron), tested with `chip-cli`. **Hooking it into the app happens at the team integration checkpoint** once the app shell exists ✅.

## 12. Team game plan ✅
| Person | Builds now | AIs |
|---|---|---|
| **Chanuth** | Planning every agent with Claude; integration lead; reviews and approves | Claude, Codex, AGY |
| **Melvin** | **Chip's logic** (orchestrator, jobs, mood, presence, nudges, prompt): `agents/01-chip-BUILD-LANES.md` | Claude, Codex, AGY |
| **Shafeen** | **Sponsor tech for Chip** (Backboard client + assistants + memory API, ElevenLabs voices/TTS/STT/SFX, Tiger schema + stores): `agents/01-chip-SPONSOR-LANES-SHAFEEN.md` | Claude, Codex, AGY |
| **Zarin** | **All graphics**: rig + animate every animal, biome (`animations/Zarin_Graphics_and_Git_Plan.txt`) | ChatGPT + Codex only |

- **App shell + renderer** (`app/shell`): **Chanuth builds it**, starting after at least 4 agent plans are done.

## 13. Build method (Hydra flow plan)
- From `C:\Chanuth\hydra\models.json` + `docs/ORCHESTRATOR.md`:
  - one **Claude Opus 5.5 orchestrator** per person (plans, dispatches, audits, merges)
  - **Codex GPT-6 Sol** as the default implementer
  - **GPT-6 Luna** for simple modules
  - **Claude Sonnet 5.5** for writing-heavy lanes
  - **AGY Gemini 3.8 Flash High** only for value-floor lanes
- Escalate effort before band; backups on a different subscription.
- **Implementers never get MCP access** (Codex `--ignore-user-config --disable apps`; deny MCP prompts in Claude/AGY).
- One git worktree per lane, owned paths only, merge one lane at a time, the orchestrator re-runs tests itself.
- Cross-vendor review for fragile code.

## 13b. Git workflow ✅ (`GIT-WORKFLOW.md`)
- Nobody works on `main`. **Branch per agent per track:** `<agent>/logic` (Melvin), `<agent>/sponsors` (Shafeen), `<agent>/graphics` (Zarin), e.g. `chip/logic`, `chip/sponsors`, `chip/graphics`. Also `app/shell`, `biome/forest`, `docs/plan`.
- AI lanes: `lane/<agent>-<track>-<lane>` worktrees, merged into the person's branch.
- **Shared contracts go to `main` first** (quick PR, Chanuth approves); everyone rebases.
- Melvin pulls Shafeen's sponsor kit with `git merge origin/chip/sponsors` before the app exists.
- **Chanuth merges every branch into `main` via PR** once the app shell exists: `app/shell` → `<agent>/sponsors` → `<agent>/logic` → `<agent>/graphics`. Same for every agent.
- `.blend` via Git LFS; `.glb` ≤ 5 MB and `.mp3` in normal git; never commit `.env`.

## 13c. Zarin's AI routing ✅
- **Codex only** (Codex = her ChatGPT account; no Claude; **no AGY**, which is weak at graphics).
- **Zarin has already made files.** Her plan (`animations/Zarin_Graphics_and_Git_Plan.txt`) gets **adjusted after she pushes them**; don't expand it before then.
- Codex GPT-6 Sol (medium) writes the Blender check + export scripts; GPT-6 Luna (medium) writes the required-clips list; ChatGPT chat for animation/rigging help. Plan: `animations/Zarin_Graphics_and_Git_Plan.txt`.

## 14. Working rules (how Chanuth wants Claude to work)
- **Plan only until Chanuth says build.** No code, scaffolding, or installs during planning.
- **Explain every plan in detail in chat** for Chanuth to verify, then revise.
- Save everything decided into these MD files.

## 15. Document index
| File | What |
|---|---|
| `DECISIONS.md` | This log |
| `README.md` | Overview, scope, timeline, demo script, risks |
| `ARCHITECTURE.md` | System design + **locked shared contracts** |
| `SPONSORS.md` | Backboard / ElevenLabs / Tiger Data plan (Chip first, then every animal) |
| `ASSETS.md` | 3D pipeline, clip names, biome markers |
| `AGENTS.md` | v0 overview of all animals (superseded section by section by `agents/`) |
| `agents/01-chip-orchestrator.md` | Chip spec v3.1 (final) |
| `agents/01-chip-BUILD-LANES.md` | Melvin's parallel build plan for Chip |
| `agents/01-chip-SPONSOR-LANES-SHAFEEN.md` | Shafeen's parallel build plan for Chip's sponsor tech |
| `animations/chip-actions.md`, `animations/Chip_Animations_for_Zarin.txt` | Chip's animation list |
| `animations/Zarin_Graphics_and_Git_Plan.txt` | Zarin's setup, branches, saving, Codex tools, order of work |
| `GIT-WORKFLOW.md` | Branches and merges for everyone |
| `PROMPTS.md` | Copy-paste prompts for each person's AI (Melvin, Shafeen, Zarin; more per agent) |
| `agents/02-archie-files.md` | Archie (beaver, files) spec v1 ✅ **approved**; also defines the shared **AgentRuntime** |
| `agents/02-archie-BUILD-LANES.md` | Melvin's lanes for Archie + AgentRuntime |
| `agents/02-archie-SPONSOR-LANES-SHAFEEN.md` | Shafeen's lanes for Archie |
| `animations/archie-actions.md`, `animations/Archie_Animations_for_Zarin.txt` | Archie's animation list (21 actions + props) |
| `agents/03-warden-security.md` | Warden (wolf, security) spec v1 ⏳ **pending approval**: rules W0–W16, approvals, injection screen, lines |
| `agents/03-warden-BUILD-LANES.md` | Melvin's lanes for Warden (replaces Chip's stub gate) |
| `agents/03-warden-SPONSOR-LANES-SHAFEEN.md` | Shafeen's lanes for Warden (voice lines, Tiger audit, Backboard classifier) |
| `animations/warden-actions.md`, `animations/Warden_Animations_for_Zarin.txt` | Warden's animation list (19 actions) |

## 15a. Melvin's original docs (repo)
- `VISION.md` stays as the vision contract (north star, principles, Thronglets framing, demo safety, long-term phases), updated to match these decisions. `concept.md` is archived as `docs/archive/concept-v0.md`.
- **Melvin's demo task adopted** for when those agents are planned: *"Turn the notes on my desktop into a report with 3 sources."* Archie reads the notes → Scout researches → Pixel writes the Google Doc → Warden stops the delete.
- "Long-term memory: WON'T" in the old VISION is **reversed**: per-animal memory is a core feature (Backboard).

## 15c. Archie plan ✅ APPROVED (Oct 4)
- Spec, lanes, animations, prompts: `agents/02-archie-*`, `animations/archie-actions.md`, `animations/Archie_Animations_for_Zarin.txt`, `PROMPTS.md` (Archie sections).
- **Shared AgentRuntime** (runs every specialist) is built in Archie's logic lanes (lane R); `beaver/logic` branches from `chip/logic` ✅.
- **Contract additions** ✅: `file_note` artifact kind, `ToolContext.threadId`, `FileOp`/`FileOpsJournal`, `DocumentsApi`. They land via a **small follow-up PR (`contracts/archie` → `main`) after Melvin's `contracts/shared` PR merges**.
- **Soft trash** ✅: "delete" moves files to `Documents/ADE Trash/<batch>/…` (journaled, undoable); batches older than 7 days are swept to the Windows Recycle Bin (`shell.trashItem`) on app start; never permanent delete. ADE Trash is always inside the sandbox and excluded from search/organize.
- **Warden rule W11** ✅ (implement when Warden is planned): undoing ADE's own journaled batch runs without asking.
- **W3** ✅: every single move/rename/mkdir asks Warden; a plan gets one approval for the whole batch.
- **Undo journal** ✅: local `file-ops.jsonl` is primary; Tiger `file_ops` is a copy.
- **Talking files** ✅: Archie's voice with a softer "paper" delivery; Archie holds the note at his own spot.
- **Default allowed folders** ✅: Desktop, Documents, Downloads. **Archie's spot** ✅: bottom-left above the taskbar.

## 15e. Warden plan ⏳ PENDING APPROVAL
- Spec, lanes, animations, prompts: `agents/03-warden-*`, `animations/warden-actions.md`, `animations/Warden_Animations_for_Zarin.txt`, `PROMPTS.md` (Warden sections, marked "use only after approval").
- Nothing here is approved yet. Open decisions are listed in `agents/03-warden-security.md §19`: Warden never cowers (Guard/Proud), new rules W12–W16, no "always allow", 5-min approval timeout, the layer-2 classifier, screening specialist summaries, silent on allow, pre-generated lines, "new things in ADE-owned places = draft", contract additions (`contracts/warden`), fail closed.

## 15d. Desktop movement
- **MVP:** animals stand on the taskbar. **Dragging animals anywhere on the screen = post-MVP** ✅.

## 15b. Pipeline ✅
- Chanuth plans one agent at a time with Claude while the team builds the previous one. Each finished plan goes straight to Melvin (logic), Shafeen (sponsors), and Zarin (graphics).
- Plan order: **Chip ✅ → Pixel → Warden → Archie → Scout** → app shell plan → Swarm → extras.
- **The app shell is built by Chanuth's idle Codex + AGY seats** (Claude stays on planning). Its plan gets written **only when Chanuth says so**.

## 16. Next up
1. Push all docs to the team GitHub (Chanuth sends the link; inspect the existing files first).
2. Plan **Pixel** (Google Workspace) next, then Warden, Archie, Scout, Swarm; extras last.
3. After 4 agent plans: Chanuth builds the app shell.
