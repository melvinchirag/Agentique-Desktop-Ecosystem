# ADE (Agentique Desktop Ecosystem): Vision

*ADE = Agentique Desktop Ecosystem (formerly "Living Desktop"). Vision owner: Melvin Karupati. Architecture & implementation plan: Chanuth (lead engineer).*
*This is the "vision contract": what the product must be. **How** it's built is the lead engineer's call.*

> **Living document.** We update this file as the project evolves. Items marked **[MELVIN DECIDES]** are open vision choices.
> **Updated Oct 4, 2026 (early morning)** to match the build decisions in `docs/DECISIONS.md` (names, team roles, integrations, scope). The original concept doc is archived at `docs/archive/concept-v0.md`.

## Team
| Person | Role |
|---|---|
| **Melvin Karupati** | Idea and vision owner. Builds each agent's logic, starting with **Chip** |
| **Chanuth** | Lead engineer: the entire architecture and the per-agent plans; integration lead; builds the app shell |
| **Shafeen (Shaff)** | Sponsor tech: **Backboard**, **ElevenLabs**, **Tiger Data** for every agent |
| **Zarin** | All graphics: rigs and animates every animal in Blender |

**Workflow:** Chanuth's master implementation plan splits the work into tasks for each person. Each person's AI tools (Claude, GPT, and Melvin's automation assistant Otto) build those tasks; the humans delegate, supervise and review. Everything lives in one master GitHub repo on Melvin's account; its structure is Chanuth's call. **Read `docs/DECISIONS.md` first**; branch rules are in `docs/GIT-WORKFLOW.md`.

**Integrations (MLH challenges we're entering):**
- **Backboard.io**: every animal's brain and long-term memory, on the user's own AI model
- **ElevenLabs**: every animal's original voice, emotions in the voice, hearing the user, sound effects
- **Tiger Data**: the ecosystem's history: replay, audit trail, mood over time, reminders

Plus the **Google Workspace APIs** for the Google Workspace agent. *Gemini and Vultr are dropped.* Full plan: `docs/SPONSORS.md`.

---

## 1. North star

**Your computer becomes a living world: a society of AI creatures that live on your desktop, understand everything on it, and work together for you, where you can watch it happen.**

Today, AI on a computer is invisible: a chat box, a sidebar, a script running somewhere. ADE makes AI **visible, alive and social**. You don't open an assistant; you live alongside an ecosystem.

**Inspiration:** Black Mirror, *"Plaything"* (the Thronglets). In the episode, a digital society quietly takes control of its owner. **Ours is the opposite: a society that works for you, in the open, and always asks before it acts.** That contrast is part of the story we tell.

---

## 2. Principles (non-negotiable)

These define the product. If a build decision breaks one of these, it's the wrong decision.

1. **It's alive.** Creatures move, idle, react to what you do, and notice changes on the desktop. A frozen pet is a broken product.
2. **It's a society, not an assistant.** Multiple agents with different roles that visibly talk to and help each other. One chatbot with a mascot is not this product.
3. **It does real things.** Agents act on real files and real apps. Pure animation is not enough.
4. **Themes are skins only.** Desert, Snow, Rainforest change the look, never the function. Desert "Chip" = Snow "Chip".
5. **You're always in control.** Nothing destructive (delete, overwrite, send, buy) happens without your OK. One click stops everything.
6. **Calm, not chaotic.** It lives on your screen all day, so it must never get in your way. Clicks pass through to your apps; creatures stay out of the way when you're working.
7. **Light and fast.** Objects sleep until needed; the app shouldn't slow the computer or burn money in the background.

---

## 3. The world

### Agent classes
| Class | What it is | Personality |
|---|---|---|
| **Pet agents** | The themed creatures. They talk to you, plan, and delegate | Yes, each one has a character |
| **App agents** | One per app (Chrome, Word, Files…). They act inside that app | Light: a small badge or helper creature near the app |
| **Object agents** | Every file, folder and icon. They know what they are | Minimal: they "wake up" when touched |
| **The Hive** | The shared space where all agents talk | It's visible: you can see who's talking to whom |

### The cast (decided)
Every agent is a character. Each creature's animal fits its job.

| Character | Agent | Job |
|---|---|---|
| 🐿️ **Chipmunk** | **Chip** (the main agent; formerly "Yappy") | Your only point of contact. Talks with you, reads your mood, and **hands work to the right animals** |
| 🐜 **Ants** | **Swarm** (Planner) | Breaks big goals into steps. Swarm only plans: Chip hands out each step, and **an ant walks the task over to the animal doing it** |
| 🐺 **Wolf** | **Warden** (Security / Guardian) | Checks every action, asks your permission first, keeps an audit trail |
| 🦫 **Beaver** | **Archie** (File manager) | Builds, moves, sorts and organizes your files and folders; can make a file "tell you" what's in it |
| 🦅 **Eagle** | **Scout** (Browser / research) | Flies off the screen to the web: searches and reads, always with sources |
| ✨ **Custom character** | **Pixel** (Google Workspace) | Gmail, Calendar, Drive, Docs, Sheets. Writes drafts in your style; **never sends**. Design by Zarin |
| 🦋 **Butterfly** | **Iris** (Social media, extra) | Drafts posts in your voice; never posts |
| 🐦 **Nightingale** | **Celene** (Music, extra) | Music that matches your mood |

**How themes fit:** the agent's job never changes. Themes (we call them **biomes**: forest, desert, snow…) can restyle the cast without changing any behavior. ✅ This cast is the default. **Biome visuals are deferred for the hackathon:** the animals live on the plain real desktop first.

### How you interact
- **You talk to Chip**: click-and-hold Chip to speak, or type in the Agent Hub. Chip hands the work to the others, and you **watch the creatures react and work**: an ant carries each step, Scout takes off for the web, Archie gets to work on files.
- **The Agent Hub**: a small draggable box, the only app-like UI. It shows what every animal is doing, wakes animals that went to sleep, and holds the chat and memories.
- **Clicking another animal** shows what it's doing (proposed).
- **Keyboard shortcuts**: later (not for the hackathon).

### Look and feel
- **Inspired by ChatGPT's desktop Pets and Dots:** the same polished texture and smooth, expressive animation quality those agent pets have.
- **An arcade-y feel:** playful, bright, game-like reactions, like a living arcade on your desktop.

### What makes it feel alive
- Idle behavior: wandering, sleeping, playing with each other
- Reactions: a file gets dropped on the desktop → a pet walks over to inspect it
- Visible conversation: speech bubbles between pets when they coordinate
- Celebration when a task finishes

---

## 4. Hackathon vision (Oct 3–4, 2026)

### The goal
Win **Ideation Matrix** (the wildcard track) and compete for overall top 3 with one unforgettable demo: **judges watch a society of creatures do real work on a real computer.**

### Scope: must / should / could / won't
| Priority | What |
|---|---|
| **MUST** | Transparent overlay with creatures walking on the real Windows desktop; click-through works |
| **MUST** | Click a pet → chat → it answers in character |
| **MUST** | **Chip** visibly hands work to other agents; for multi-step goals **Swarm (ants)** plans first and an ant carries each step |
| **MUST** | Agents doing real actions: **Pixel (Google Workspace)**, **Archie (files)**, **Scout (web)** |
| **MUST** | **Warden (Wolf)** confirmation before anything destructive; nothing is ever sent or posted |
| **MUST** | **Chip (Chipmunk, the main agent)** chats in character, reads your mood, and reaches out first (reminders, "how did your exam go?") |
| **MUST** | Every animal **speaks** with its own voice (ElevenLabs) |
| LATER | Keyboard shortcuts: whole ecosystem + per agent |
| **MUST** | Google Workspace agent (**Pixel**, custom character) |
| COULD | Nightingale (music) and Butterfly (social media) |
| **MUST** | The full demo task works end to end, at least 5 times in a row |
| COULD | Object agents: a desktop file "wakes up" and describes itself (through Archie) |
| LATER | **Biome (theme) switch**, same agents, new look |
| COULD | Idle social behavior (pets playing, sleeping) |
| **MUST** | Voice: talk to Chip out loud |
| WON'T (hackathon) | macOS/Linux, accounts, theme marketplace, more than 1 biome. (*Long-term memory moved to MUST: every animal remembers you via Backboard, and you can see and erase it.*) |

### What we cut first if time runs short
1. Idle social behavior → 2. Celene + Iris (extras) → 3. Object agents → 4. Swarm's ant animation (Chip still delegates).
**Never cut:** creatures on the real desktop, Chip handing work to others, Pixel + Archie + Scout doing real actions, Warden, Chip chat + voice.

### The demo moment (about 3 minutes) **[MELVIN DECIDES the final task]**
1. **(0:00)** Clean desktop. "Every AI today is invisible. What if you could *see* it?" Launch the app (or hit the ecosystem shortcut). The creatures appear and start wandering. *(First reaction.)*
2. **(0:30)** A judge clicks Chip the chipmunk and chats with it. It answers in character.
3. **(1:00)** The goal: *"Turn the notes on my desktop into a report with 3 sources."*
4. **(1:15)** Chip asks **Swarm** for a plan; then for each step an ant carries the task to the right animal. **Archie** hauls `notes.txt` over, which wakes up and hands over its contents. **Scout** flies off the screen and searches the web. **Pixel** writes the report into a Google Doc. *(The main moment.)*
5. **(2:15)** Archie tries to delete the old notes. **Warden steps in and asks permission**. "This society always asks first: the opposite of the Thronglets."
6. **(2:40)** *(Later, when biomes exist)* "Same society, new world": switch biomes live. Same agents, new look.
7. **(3:00)** Close: "Not an assistant with a mascot. A living society that works for you."

### Demo safety rules
- Run the demo on a **prepared demo desktop folder** with staged files, never on personal files.
- Have a **recorded backup video** of the full demo in case Wi-Fi or an API fails.
- Rehearse the exact demo task many times; the AI should be tested on that task, not improvising.

### Hackathon success criteria
- The demo runs live without a crash.
- Judges react out loud at step 1 or step 4.
- A judge can explain the product in one sentence afterward.

---

## 5. Long-term vision

### Phase 1: after the hackathon (1–3 months): "It works every day"
- Stable Windows app people can install and keep running
- More App agents through MCP (email, calendar, Spotify, Slack, VS Code)
- **Memory:** pets remember you, your files and your habits
- More themes; first **user-made themes** (upload art, keep the same agents)

### Phase 2 (3–9 months): "A real ecosystem"
- **Agents grow with you:** pets gain experience and new abilities the more they help
- **Plugin SDK:** developers build new App agents (any app with an MCP server plugs in)
- **Theme marketplace:** artists publish themes; creators can sell them
- macOS support

### Phase 3 (9+ months): "The visible layer for AI"
- ADE becomes **the human-friendly face of AI on your computer**: whatever AI tools you use, you see them as creatures doing the work, and you approve what matters
- Shared worlds: your society can collaborate with a teammate's society on a shared project
- Possible model: free core app with a few themes; paid premium themes and pro agents; revenue share for theme artists **[MELVIN DECIDES]**

### What we will never become
- A society that acts behind your back (the Thronglets)
- An app that sells your data: local-first by default
- Clutter: it must stay calm enough to run all day

---

## 6. Risks to keep in mind
| Risk | Why it matters | Our answer |
|---|---|---|
| Big companies (OpenAI Pets, Microsoft Copilot / UFO) | They have desktop AI already | They make one assistant. We make a visible society with themes and personality |
| Agents doing damage | Real files and apps are at stake | Wolf (Guardian) + confirmation + one-click stop |
| Cost and speed | Many agents can be slow and expensive | Objects sleep; only active agents think |
| Too distracting | It lives on screen all day | Calm mode, click-through, creatures avoid busy areas |

---

## 7. Open vision decisions [MELVIN DECIDES]
1. ~~Product name~~ → **ADE (Agentique Desktop Ecosystem)** ✅
2. ~~Characters per agent~~ → **decided** (see The cast) ✅
3. ~~Google Workspace custom character~~ → **Pixel** (design by Zarin) ✅
4. ~~Themes~~ → this cast is the default; biome visuals deferred for the hackathon ✅
5. **Personality** of each character: voices are designed with ElevenLabs (`docs/SPONSORS.md`), catchphrases in each agent plan. Keyboard shortcuts → later.
6. **The exact demo task**: the report task above is adopted; finalize once Pixel, Archie and Scout are planned
7. **The one-sentence pitch** you'll say to judges
8. **Long-term business model** (later)
