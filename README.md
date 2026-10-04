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
