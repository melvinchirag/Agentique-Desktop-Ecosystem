# ADE: Agentique Desktop Ecosystem

**A society of AI animals that lives on your real Windows desktop and does real work for you, out in the open.**
Download the `.exe`, connect your own AI, and talk to Chip. Watch the animals hand off work, talk to each other out loud, and always ask before anything risky.

Built at **Hack Dearborn 5: Conjure Reality** (Oct 3–4, 2026) by Chanuth Jayatissa, Melvin Karupati, Shafeen Rahman, and Zarin Zara.
Tracks: **Ideation Matrix**, **VentureWell Innovation**. MLH: **Backboard**, **ElevenLabs**, **Tiger Data**.

| Animal | Job |
|---|---|
| 🐿️ **Chip** | The one you talk to. Reads your mood and hands out the work |
| ✨ **Pixel** | Google Workspace: Gmail, Calendar, Drive, Docs, Sheets. Writes in your style, never sends |
| 🐺 **Warden** | Security: checks every action, asks first, keeps the audit trail |
| 🦫 **Archie** | Files |
| 🦅 **Scout** | Web research, with sources |
| 🐜 **Swarm** | Planning |
| 🦋 **Iris** · 🐦 **Celene** | Social post drafts · mood music (extras) |

## Status: v0.2 (Nov 2, 2026)
| Part | Where it runs |
|---|---|
| The AI's thinking | **Backboard** (cloud), Gemini 2.5 Flash by default. Your own Claude Code / Codex / Gemini sign-in is planned, not built |
| Memories, Timeline, Audit, chat history | **On your computer**, one SQLite file (`%APPDATA%\ADE\ade.db`). No Backboard memory, no Tiger |
| Voices | ElevenLabs (optional) |
| Gmail / Calendar (Pixel) | Google sign-in (needs the Google client keys) |

New in v0.2: talk to an animal while it works ("Archie, skip the PDFs"), drag animals along the taskbar, easy quit (Hub ✕, tray, Ctrl+Shift+Q), a Setup screen for your own Backboard key. Full list and limits: [`docs/RELEASE-0.2.0.md`](docs/RELEASE-0.2.0.md). The docs below were written at the hackathon (Oct 4); where they say Tiger or Backboard memory stores history, v0.2 stores it locally.

Run it: `npm install`, then `npm run dev` (or `scripts\start-ade.cmd`). Build the installer: `npm run build:win`.

## Read first
| Doc | What |
|---|---|
| [`VISION.md`](VISION.md) | The vision contract: north star, principles, demo |
| [`docs/PROMPTS.md`](docs/PROMPTS.md) | **Copy-paste prompts: each person's AI starts from here** |
| [`docs/DECISIONS.md`](docs/DECISIONS.md) | **Every build decision in one log** |
| [`docs/README.md`](docs/README.md) | Plan overview, scope, timeline, risks |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | System design + locked shared contracts |
| [`docs/SPONSORS.md`](docs/SPONSORS.md) | How Backboard, ElevenLabs, and Tiger Data are used |
| [`docs/GIT-WORKFLOW.md`](docs/GIT-WORKFLOW.md) | Branch per agent per person; how merges work |
| [`docs/agents/`](docs/agents/) | Per-agent specs and build plans (Chip first) |
| [`docs/animations/`](docs/animations/) · [`docs/ASSETS.md`](docs/ASSETS.md) | 3D + animation pipeline |

## Branch rules (short version)
Never work on `main`. Use `<agent>/logic` (Melvin), `<agent>/sponsors` (Shafeen), `<agent>/graphics` (Zarin), and `app/shell` (Chanuth). Open a PR into `main`; Chanuth merges. Never commit `.env` or keys.
