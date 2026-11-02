# ADE — Agentique Desktop Ecosystem (Hack Dearborn 5)

> **v0.2 update (Nov 2, 2026):** this document was written for the Hack Dearborn build (Oct 4). Since v0.2, memories, Timeline, Audit, Pulse, Replay and chat history are stored locally in `%APPDATA%\ADE\ade.db` (no Backboard memory, no Tiger; Tiger is optional and off by default). Backboard still runs the AI (Gemini 2.5 Flash by default) and Archie's document reading, until the CLI brain replaces it (decided Nov 2). What the code does now: [`docs/RELEASE-0.2.0.md`](RELEASE-0.2.0.md).

> Animated AI animals that live **directly on your real Windows desktop** and do real work for you.
> Download the .exe, pick your AI, connect Google, and start talking.

This folder is the **source of truth** for the build. Every teammate's AI (Claude, Codex, AGY) should read
all three files before writing code:

| File | What it covers |
|---|---|
| **`DECISIONS.md`** | **Every decision in one log. Read first.** |
| `GIT-WORKFLOW.md` | Branch per agent per person; how merges into `main` work |
| `README.md` (this file) | Decisions, scope tiers, team split, timeline, demo script |
| `ARCHITECTURE.md` | System design, repo layout, **locked shared contracts**, runtime loop, Wolf gate, sponsor integrations |
| `SPONSORS.md` | Exactly how Backboard, ElevenLabs, and Tiger Data are used: Chip first, then the whole project and every animal |
| `ASSETS.md` | 3D pipeline for Zarin: export settings, exact animation clip names, biome markers, drag-and-drop folders |
| `agents/01-chip-BUILD-LANES.md` | Melvin's parallel build plan for Chip's logic |
| `agents/01-chip-SPONSOR-LANES-SHAFEEN.md` | Shafeen's parallel build plan for Chip's sponsor tech |
| `animations/` | Chip's animation list (md + txt for Zarin) |
| `agents/01-chip-orchestrator.md` | **Detailed** Chip spec (done). One file per agent, written one at a time. |
| `AGENTS.md` | v0 overview of all agents. A detailed `agents/NN-*.md` file replaces each section as it's written. |

---

## 1. Targets

| Prize | How ADE wins it |
|---|---|
| **Ideation Matrix** (main track) | "Rethink what technology can do… immersive… blurs reality and imagination." Agents become a living forest you can watch, hear, and talk to. Theme tie-in: we *conjure* imaginary creatures into a working reality. |
| **VentureWell Innovation** | Originality (role-based visible agent ecosystem), meaningful problem (agents only usable by technical people), solid live prototype, real-world impact (non-technical users + marketplace business model). |
| **MLH: Best Use of Backboard** | Every animal is a Backboard assistant with its own persistent memory; any model you choose; tool calling; web search; a "what the forest remembers" memory screen. |
| **MLH: Best Use of Tiger Data** | Every agent action lands in a TimescaleDB hypertable → Wolf's audit trail, activity stats, and **Biome Replay** (replay any past task as an animation). |
| **MLH: Best Use of ElevenLabs** | Original creature voices made with Voice Design (no cloning), mood-driven delivery with audio tags, lip-synced mouths, creature sound effects, push-to-talk speech-to-text. |

Not entering: Gemini (users bring their own AI instead — fewer sponsors, each used deeply), Solana (clashes with "easy for non-technical users"; the verified-agent registry goes on the roadmap slide), Vultr.

Judging rubric (1–5 each): Implementing Technology · Overall Design · Quality of Solution · Team Presentation · Track/Concept ("2–4 unique features, fits the track in multiple ways").
Our 4 headline features: **(1) visible agent handoffs, (2) the mood system, (3) Wolf safety gate, (4) per-animal voices.**

---

## 2. Locked decisions

| Decision | Choice | Why |
|---|---|---|
| App type | **Desktop app, Windows .exe installer** | Download-and-go is the whole pitch |
| Stack | **Electron + electron-vite + React + TypeScript + React Three Fiber (drei)**, packaged with **electron-builder (NSIS)** | All TypeScript, so all 11 AI seats are strong at it. Three.js runs reliably in Electron's Chromium. Tauri would mean Rust plus WebView2 quirks with 3D. |
| LLM layer | **All LLM calls go through Backboard.** The user picks their own AI (provider + model) per animal in Settings. No direct model APIs. | That *is* "connect your own AI", and it's Backboard's core feature |
| Orchestrator | **Chipmunk** = the orchestrator (name "Chip"). "Yapper" is just its personality. | One brain the user talks to |
| Google Workspace character | **Custom character** (design + name TBD). Covers Gmail, Calendar, Drive, Docs, Sheets. | |
| 3D | **Every animal is rigged in Blender** (Zarin). Drag-and-drop asset pipeline with procedural fallback (`ASSETS.md`). | Art never blocks code |
| Names | Locked: **Chip** (chipmunk), **Warden** (wolf), **Scout** (eagle), **Swarm** (ants), **Celene** (nightingale), **Archie** (beaver), **Pixel** (Google Workspace), **Iris** (butterfly). Display names live in one config file. | |
| Biomes & skins | Data-driven from day one: `biomes/<id>/`, `characters/<agent>/<skin>/`. Forest ships; desert/snow are drop-ins later. | |
| Sending | **ADE can never send email or post anything.** No send tool exists, and Wolf denies the category anyway. | Core trust story |
| Secrets | API keys live only in the Electron main process (`.env` for dev, `safeStorage` for the packaged app). Never in the renderer. | Security + demo safety |

---

## 3. Agent roster and scope

| Agent | Animal | Job | Tier |
|---|---|---|---|
| **Chip** | Chipmunk | Orchestrator + mood | Core |
| **Pixel** | Custom character | Google Workspace (Gmail, Calendar, Drive, Docs, Sheets) | Core |
| **Warden** | Wolf | Security gate, approvals, audit, prompt-injection guard | Core |
| **Archie** | Beaver | Files | Core |
| **Scout** | Eagle | Web research / browser | Core |
| **Swarm** | Ants | Planner (day plan, goal → steps → calendar blocks) | Core |
| **Iris** | Butterfly | Social post drafts | Extra (asleep until built) |
| **Celene** | Nightingale | Mood music | Extra (asleep until built) |

**Checkpoints:**
- **3 AM:** Chip + Workspace + Wolf working end-to-end.
- **5 AM:** all six core agents.
- Extras only after 5 AM if everything core is solid. Marketplace + biomes = one static screen.

---

## 4. Team split (game plan ✅)

| Person | Builds | Plan file | AIs |
|---|---|---|---|
| **Chanuth** | Plans every agent with Claude; integration lead; approves contract changes | `DECISIONS.md` | Claude, Codex, AGY |
| **Melvin** | **Chip's logic** (orchestrator, jobs, mood, presence, nudges, prompt) | `agents/01-chip-BUILD-LANES.md` | Claude, Codex, AGY |
| **Shafeen** | **Sponsor tech** (Backboard client + assistants + memory API, ElevenLabs voices/TTS/STT/SFX, Tiger schema + stores), Chip first, then every animal | `agents/01-chip-SPONSOR-LANES-SHAFEEN.md` | Claude, Codex, AGY |
| **Zarin** | **All graphics**: rig + animate every animal, biome | `ASSETS.md`, `animations/Zarin_Graphics_and_Git_Plan.txt` | Codex only |
| **Chanuth** | **App shell + renderer** (3D scene, Agent Hub UI, chat, Memories/Pulse/Audit screens), after 4 agent plans | `ARCHITECTURE.md §5` | Claude, Codex, AGY |

Method for every builder: Hydra flow plan (Opus orchestrator → Codex/Sonnet/AGY lanes in worktrees). See `DECISIONS.md §13`.

---

## 5. Timeline (Sat Oct 3, 10 PM → Sun Oct 4, 12 PM)

| Time | Milestone |
|---|---|
| **Now → 10:45 PM** | Everyone: sign up for Backboard, ElevenLabs, and Tiger Cloud (hackathon credits). Melvin: Google Cloud project + OAuth "Desktop app" client + add test users. Chanuth: scaffold repo, push the `src/shared` contracts. ~~Devpost project~~ ✅ done. |
| 10:45 PM → 3:00 AM | Core modules built in parallel. Each module is testable alone (mock EventBus / mock Backboard). |
| **3:00 AM — Integration 1** | "Chip, what emails did I get today?" works end-to-end with animation + voice. |
| 3:00 → 5:00 AM | Remaining core: drafts in your style, Wolf approvals, Beaver organize, mood contagion. Sleep in shifts (2 people at a time, 90 min). |
| **5:00 AM — core freeze** | Full demo path works. From now on, a bug fix beats a new feature. |
| 5:00 → 8:30 AM | Extras + polish. Melvin + Shafeen start Devpost text and slides at 7:30. |
| **8:30 AM — feature freeze** | Only bug fixes after this. |
| 8:30 → 10:00 AM | Run the demo 5× on the demo laptop. **Record a backup demo video.** Build the .exe. |
| 10:00 → 11:30 AM | Slides final, Devpost final (video, screenshots, track = Ideation Matrix, opt into VentureWell + MLH challenges), rehearse pitch 3×. |
| **11:30 AM** | Submit. (Hard deadline 12:00 PM.) |
| 1:00 PM | Demo setup in Kochoff Hall. Judging 1:30–3:00. |

---

## 6. Five-minute demo script (draft)

1. **(0:00) Problem** — "Agents can do your busywork, but only if you can code. 99% of people can't." One slide.
2. **(0:30) Open ADE** — the forest wakes up; each animal says hi in its own voice.
3. **(1:00) "Chip, what emails did I get today?"** — Chip hands the task to the Workspace character, who sorts through the inbox, Chip summarizes out loud. (Backboard + ElevenLabs.)
4. **(1:45) "Draft a reply to Professor X saying I'll be there."** — the Workspace character drafts in *your* style; the draft appears in Gmail. "Now send it." → **Warden leaps in, growls, refuses**: "I never send. Your draft is waiting in Gmail." (Safety story.)
5. **(2:30) Mood** — say something frustrated. Chip turns blue and gets scared, the fear ripples through the forest, Chip calms you down and offers to help. (Ideation Matrix.)
6. **(3:00) "Beaver, clean up my Downloads."** — Beaver proposes a plan, Wolf asks for approval, files move. One-click undo.
7. **(3:30) Biome Replay + Wolf audit** — scrub the timeline and the forest replays what happened. (Tiger Data.)
8. **(4:00) Business + vision** — marketplace, biomes, verified agent registry. Close with the line.

---

## 7. Top risks

| Risk | Mitigation |
|---|---|
| Scope creep | Tiers above. Integration checkpoints at 3 AM and 5 AM. |
| Demo breaks live (Wi-Fi, OAuth, rate limits) | Pre-authorize Google on the demo laptop. Phone hotspot. Backup video. "Demo mode" flag that replays a recorded Tiger session if the network dies. |
| 3D animation late | Procedural fallback for any missing model or clip (`ASSETS.md §4`). Zarin does the core 6 clips for every animal before any extras. |
| Merge conflicts across 11 AIs | Contracts in `src/shared` are locked; each person only edits their own folders; Chanuth merges. |
| Looks like "a chatbot with a skin" | Animations are driven only by real events; real drafts appear in real Gmail. |
