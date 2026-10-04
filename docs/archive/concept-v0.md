> **Archived (Oct 4, 2026).** Melvin's first concept doc, kept for history. The architecture here (Tauri, MCP app agents, Gemini/Vultr) is **superseded** by `docs/ARCHITECTURE.md` and `docs/DECISIONS.md`.

# ADE (Agentique Desktop Ecosystem) — Concept

*ADE = Agentique Desktop Ecosystem (formerly "Living Desktop"). Hack Dearborn: Conjure Reality · October 3–4, 2026 · University of Michigan–Dearborn*
*Living document: we update this file and `VISION.md` as the project evolves.*

## Team
| Person | Role |
|---|---|
| **Melvin Karupati** | Idea and vision owner; integrations (with Shaff) |
| **Chanuth** | Lead engineer: the entire architecture and the implementation plan |
| **Shaff** | Integrations (with Melvin) |

**How we work:** Chanuth's master implementation plan delegates tasks to Melvin, Shaff and their AI automation systems (Claude, GPT, Melvin's assistant Otto). The AI builds; the humans delegate, supervise and review. One master GitHub repo on Melvin's account, structured by Chanuth.

**Integrations (Melvin + Shaff):** Tiger Data, Backboard.io, Gemini API, and possibly Vultr later. Each one's exact role is set in Chanuth's implementation plan.

---

## 1. The idea in one sentence

**Your whole desktop comes alive: every object on it is an AI agent, and they live, talk and work together as one ecosystem.**

Inspired by the Black Mirror episode *"Plaything"* (the Thronglets): a small digital society that lives on your computer, except ours is genuinely useful. You install one `.exe`, and the moment it runs, creatures appear on your desktop, wander around, and can actually *do things* on your computer for you.

---

## 2. What the user experiences

- You run the app. Themed creatures appear and roam your real Windows desktop, on top of your normal apps.
- You can click a creature and talk to it, or give it a goal ("turn the notes on my desktop into a Word report with 3 sources").
- The creatures **cooperate**: they walk over to files, wake them up, call on the apps they need (Chrome, Word, File Explorer), and you watch the work happen live.
- Your files, folders and apps are not dead icons anymore. They are agents in the ecosystem too.

It feels like a living world on your screen, but it gets real work done.

---

## 3. The agent classes

Everything on the desktop belongs to one of three classes of agents.

### Class 1 — Pet agents (the themed characters)
- The visible creatures. They are the interface between you and the ecosystem.
- They talk to you, understand what you want, plan the steps, and hand work to the right agents.
- Each pet has a **role** (for example: a planner, Chip the chatty main agent, a guardian that asks before anything risky).

### Class 2 — App agents (the "skills")
- One agent per app: Chrome agent, Word agent, File Explorer agent, and so on.
- They work like skills: they turn "do X" into real actions inside that app.
- Pets never touch apps directly. They ask the right App agent.

### Class 3 — Object agents (files, folders, icons)
- Every file, folder and icon on the desktop is an agent that knows what it is ("I'm a lecture PDF about cell biology").
- They **sleep until they're needed** (a click, a drag, another agent asking). This keeps the ecosystem fast and cheap: a desktop can have 50+ items, and we don't want 50 AIs running constantly.

### The cast: every agent is a character
| Character | Agent | Job |
|---|---|---|
| 🐜 **Ants** | Planner | A colony that breaks your request into steps and hands work to the right agents |
| 🐿️ **Chipmunk** | **Chip** (main agent; formerly "Yappy") | The chatty one: your main point of contact. Talks with you and explains what's happening |
| 🐺 **Wolf** | Security / Guardian | Asks your permission before anything risky |
| 🦫 **Beaver** | File manager | Builds, moves, sorts and organizes files and folders |
| 🦅 **Eagle** | Browser | Searches, reads and acts on the web |
| 🦋 **Butterfly** | Social media | Handles your social media |
| 🐦 **Nightingale** | Music | Plays and controls your music |
| ✨ **Custom character** | Google Workspace | Gmail, Docs, Drive, Calendar (character design to come) |

### How you interact
- **Click** any creature to talk to that agent.
- **Keyboard shortcuts:** one shortcut activates the **whole ecosystem**; a shortcut per agent activates **just that one**.
- **Talk to the whole ecosystem at once** and watch the creatures react and get to work.

### Look and feel
- Inspired by **ChatGPT's desktop Pets and Dots**: the same polished texture and smooth, expressive animation.
- An **arcade-y feel**: playful, bright, game-like reactions.

### The Hive (how they all connect)
All agents talk over one shared message bus. Pets post goals and requests, App agents and Object agents respond, and the whole ecosystem can see what's happening. This is what makes it a *society* instead of a single assistant.

---

## 4. Themes are skins, not different agents

The ecosystem can be themed: **Desert**, **Snow**, **Rainforest**, and more later.

- In the Desert theme the creatures are desert animals; in Snow they're snow animals; in Rainforest they're rainforest animals.
- **The function never changes.** The Desert "Chip" agent and the Snow "Chip" agent have exactly the same brain and abilities; only the look is different.

How we build it:
- **Agent definitions** (role, personality prompt, tools) are written once, e.g. `agents/chip.json`.
- **Theme packs** only hold visuals and sound: sprite sheets, colors, names, sounds, e.g. `themes/desert/chip.png`, `themes/snow/chip.png`.
- Switching themes swaps the sprites and never touches behavior.

---

## 5. How App agents actually control apps

We use **MCP (Model Context Protocol)**, the standard way to connect AI agents to apps and tools. Each App agent is a character wrapped around an MCP server.

| App | How its App agent controls it |
|---|---|
| **Chrome** | Google's official **Chrome DevTools MCP server** (released Sep 2025, ~29 tools: navigate, click, read pages, run JavaScript) |
| **Word** | Open-source **Word MCP servers** that drive the real Word app through Windows COM automation (open, edit, format, export to PDF) |
| **Files / File Explorer** | A filesystem MCP server. Windows 11 is also adding native MCP support with a built-in File Explorer connector (Insider builds since Dec 2025) |
| **Any other app** | Fallback 1: **Windows UI Automation** (reads an app's buttons and fields). Fallback 2: screenshot + vision ("computer use") |

Adding a new app later means plugging in its MCP server. The architecture doesn't change.

---

## 6. Example: the demo moment

> You tell the ecosystem: *"Turn the notes on my desktop into a report with 3 sources."*

1. The **Ants** swarm and split the job into steps. The **Beaver** hauls `notes.txt` over; the file's **Object agent** wakes up and hands over its contents.
2. The **Eagle** flies off to the browser and searches for sources on its own.
3. The **Google Workspace agent** builds the report in a Doc, live on screen.
4. When something risky comes up (like deleting the old notes), the **Wolf** asks your permission first.
5. The report appears on the desktop, and the creatures celebrate.

Judges watch a society of agents cooperate on a real computer. That's the Thronglets moment.

---

## 7. Architecture and tech stack

```
┌──────────── SKIN (theme pack) ─────────────┐   desert / snow / rainforest
│ sprite sheets · colors · sounds · names     │   ← swappable, zero logic
├──────────── BODY (desktop overlay) ─────────┤
│ transparent window · walking · clicks ·     │   ← Tauri .exe
│ speech bubbles · drag & drop                │
├──────────── BRAIN (agents + the Hive) ──────┤
│ role + prompt + tools + agent loop          │   ← identical across themes
│ App agents → MCP servers → real apps        │
└─────────────────────────────────────────────┘
```

- **Desktop app:** [Tauri](https://tauri.app/) (Rust backend + TypeScript frontend). Builds a small Windows `.exe` installer, much lighter than Electron.
- **Starting code:** fork [`crabnebula-dev/koi-pond`](https://github.com/crabnebula-dev/koi-pond), an open-source Tauri desktop pet (MIT license; the repo is archived, so we fork it).
- **The overlay trick:** one transparent, borderless, always-on-top window over the screen with **click-through** turned on, so normal clicks reach the apps underneath. Click-through switches off only while the cursor is over a creature.
- **Agent brain:** an LLM (Claude suggested) running the standard agent loop: think → use a tool → look at the result → repeat until the goal is done.
- **Security:** the API key must **not** be built into the `.exe` (anyone could extract it). Use a small backend or let the user enter their own key.
- **Safety:** agents act on real files and apps, so a guardian step should confirm anything destructive (deleting, overwriting, sending).

---

## 8. Build plan by layers

1. **Layer 1 — one agent that works.** One creature walks on the desktop → click it → chat bubble → it answers → it uses one App agent to do something real (move a file, open Chrome).
2. **Layer 2 — multiple agents + themes.** A second and third pet with different roles, 2–3 App agents, and the theme switcher.
3. **Layer 3 — the ecosystem.** Object agents wake up and join in, agents talk to each other over the Hive, and creatures visibly cooperate.

---

## 9. What already exists, and why we're different

| What exists | What it does | How we're different |
|---|---|---|
| **ChatGPT / Codex Pets** (OpenAI, May 2026; Quick Chat Sep 2026) | A cute face on the desktop showing the assistant's status; click to chat | One assistant with a mascot. Ours is a society of many agents |
| **Open-source AI pets** (OpenPets, CoPet, PetGPT, DSH Pet) | Desktop pets connected to an AI or coding tools | Single pets or companions, not an ecosystem acting on your desktop |
| **Microsoft UFO² "Desktop AgentOS"** (Microsoft Research, 2025) | A HostAgent splits tasks and hands them to per-app AppAgents that control Windows apps | Proves our App-agent design works, but it's invisible automation. Ours is a **visible, living ecosystem** where every object is an agent |

**Our pitch in one line:** *Not an assistant with a mascot: a living society of agents that turns your whole desktop into a world that works for you.*

---

## 10. Open decisions

1. Which **2–3 App agents** for the demo (suggested: Chrome + Word + Files)
2. The **pet roster** and each pet's role
3. Where the agent brain runs: inside Tauri (TypeScript) or a separate Python process alongside it
4. The **message format** on the Hive, and how tasks get assigned
5. Which **LLM** to use
6. Which **Hack Dearborn track** to enter (Ideation Matrix, the wildcard track, is the natural fit)
