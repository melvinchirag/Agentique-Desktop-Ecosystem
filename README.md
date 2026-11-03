# Agentique Desktop Ecosystem (ADE)

**A team of AI animal agents that lives on your Windows desktop and does real work for you, out in the open.**

You talk to Chip, a chipmunk. He hands the job to the right animal: Pixel for Gmail and Calendar, Archie for your files, Scout for web research, Swarm for planning. Warden, a wolf, stands between every agent and every action: reads pass, drafts pass, writes and moves ask you first, and sending is refused in code. You watch the hand-offs happen on your real desktop, hear each animal speak, and can replay any task from a local log.

ADE thinks with the AI you already pay for. Point it at the Claude Code, Codex or Gemini command-line tool on your machine and it runs on your own sign-in. Memories, history and the audit trail stay in one SQLite file on your computer.

## Download

**[ADE Setup 0.2.0.exe](https://github.com/melvinchirag/Agentique-Desktop-Ecosystem/releases/tag/v0.2.0)** for Windows 10 and 11 (146 MB, x64). Release notes and SHA-256 are on the release page.

1. Run the installer. It is not code signed yet, so Windows SmartScreen shows an unknown-publisher warning: choose **More info**, then **Run anyway**.
2. On first launch **ADE Setup** opens. Pick the AI you already use: ADE finds, installs and signs in **Claude Code**, **Codex** or **Gemini CLI**. Or paste your own Backboard key. Or choose **Try the offline demo** to see the animals with no account at all.
3. The animals appear on a click-through overlay above your apps. The Hub window (chat, Memories, Timeline, Audit, Settings) sits top-right. Quit from the Hub ✕, the tray icon, or Ctrl+Shift+Q.

## The animals

| Animal | Job | What it can and cannot do |
|---|---|---|
| 🐿️ **Chip** (chipmunk) | The one you talk to. Reads your mood, hands out the work, checks in once a day | No file, mail or web tools of his own. At most 3 nudges an hour, quiet 23:00 to 08:00 |
| 🐺 **Warden** (wolf) | The gate. Allows, asks or denies every tool call; screens untrusted text for prompt injection; writes the audit log | Code, not a model loop. 16 rules. Keeps no memories by design. Silent on allow, growls on deny |
| ✨ **Pixel** (firefly) | Google Workspace: Gmail, Calendar, Drive, Docs, Sheets. Drafts replies in your writing style | 18 tools, none of them sends. Never forwards, shares, deletes or edits a document it did not create |
| 🦫 **Archie** (beaver) | Files: find, read, summarize, tidy into folders, undo | Sandboxed to Desktop, Documents and Downloads. "Delete" means ADE's own trash for 7 days. A tidy-up is one plan and one approval card |
| 🦅 **Scout** (eagle) | Web research with sources, saved as a brief | Read-only web. No logins, forms or purchases |
| 🐜 **Swarm** (ants) | Breaks a big task into 2 to 6 steps and carries them to the others | Plans only |

Iris (butterfly) and Celene (nightingale) exist as characters and voices only; they are not installed by default.

## How it works

1. **You ask.** Type in the Hub or hold Chip to speak. Chip answers in voice and decides who does the work.
2. **The animals hand off.** Chip walks the job over to Archie, Pixel, Scout or Swarm. You can talk to an animal while it works: "Archie, skip the PDFs" reaches the running job at its next step, with no extra model call.
3. **Warden gates every action.** Reading and drafting run without a prompt. Moving or changing files, calendar writes and document edits show an approval card. Any send-class action (email, forward, share) is refused in code and written to the audit log. Every network connection ADE makes goes to a named host or is refused and logged.
4. **You can look it up.** Memories per animal are listed, searched, edited and deleted from the Hub. Timeline, Audit and Replay read from the same local file.

## Where things run (v0.2)

| Part | Where |
|---|---|
| The AI's thinking | **Your own AI.** `ADE_BRAIN=claude-cli`, `codex-cli` or `gemini-cli` runs that installed, signed-in command-line tool as a separate program under your account. No ADE account or key needed. Claude Code and Codex passed the full demo path live; the Gemini adapter follows Google's documented interface and has not been tested live here. Without the switch, **Backboard** (cloud) is the fallback and needs your own key. |
| Memories, chat history, timeline, audit, follow-ups, plans, research | **Your computer**: one SQLite file at `%APPDATA%\ADE\ade.db`. No cloud database. Events are kept 90 days. |
| PDFs and text files | Read on your machine (pdf.js). Word, slides and sheets still go through Backboard document indexing. |
| Voices and sounds | ElevenLabs with an optional key; the shipped voice lines play without one. |
| Gmail, Calendar, Drive (Pixel) | Google OAuth with your own client credentials (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`). |
| Network | Egress allow list: named hosts only (your AI vendor, Backboard, ElevenLabs, Google, the ADE account service). Anything else is refused and logged as a Warden alert. |

Keys and settings live in `%APPDATA%\ADE\.env`, written by the Setup screen. Nothing is shipped in the installer.

The Codex brain runs with its shell turned off, and ignores your personal Codex configuration and rules, so Warden stays the only path to your files. Vendor terms for running each CLI this way are being checked; see the release notes.

## Current limits

- The installer is unsigned. SmartScreen warns on every install until a company exists to sign it.
- Windows only. The model runs in the cloud under your sign-in, so ADE is local-first, not offline.
- Pixel needs Google OAuth client credentials, and a new user needs Google's app verification.
- Word, slides and sheets need a Backboard key. PDFs and text files do not.
- Animals drag along the ground only. ADE has no weather source; Chip can invent a forecast if asked.
- Zero users outside the four founders as of Nov 2, 2026.

Full list of changes and the manual clean-install check: [`docs/RELEASE-0.2.0.md`](docs/RELEASE-0.2.0.md). Known test failures with owners: [`docs/KNOWN-FAILURES.md`](docs/KNOWN-FAILURES.md).

## Build from source

Node 24 and npm. Electron 44, electron-vite, React 19, TypeScript, React Three Fiber.

```
npm install
npm run dev            # run the app from source (or scripts\start-ade.cmd)
npm run verify:quick   # typecheck + core tests, about 30 s
npm run test           # full Vitest suite
npm run build:win      # NSIS installer into release\
```

Add `--demo` to run the offline scripted demo with no keys, and `--devtools` to open DevTools.

## History

Built in 24 hours at **Hack Dearborn 5: Conjure Reality** (Oct 3 to 4, 2026): 303 commits and 51 merged pull requests in about 13 hours of commit history, with AI pair-programming disclosed in the commit trailers. Won the **Ideation Matrix** track (the main track) and **MLH Best Use of ElevenLabs** out of 50 submissions. Devpost: [agentique-desktop-ecosystem](https://devpost.com/software/agentique-desktop-ecosystem).

v0.2.0 (Nov 2, 2026) replaced the hackathon's cloud pieces: your own AI instead of a shared Backboard key, one local SQLite file instead of Tiger Cloud, a Setup screen, local PDF reading, an egress allow list, talking to animals mid-job, and dragging the animals.

## Team

Chanuth Jayatissa, Melvin Chirag Karupati, Shafeen R Rahman and Zarin Zara. Eastern Michigan University.

## Docs

| Doc | What |
|---|---|
| [`AGENTS.md`](AGENTS.md) | How to work in this repo: commands, lanes, contracts, PR rules |
| [`docs/RELEASE-0.2.0.md`](docs/RELEASE-0.2.0.md) | What v0.2 does, what changed, limits, clean-install check |
| [`VISION.md`](VISION.md) | North star, principles, the demo |
| [`docs/DECISIONS.md`](docs/DECISIONS.md) | Every build decision in one log |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md), [`docs/agents/`](docs/agents/) | Hackathon-era system design and per-agent specs. Where they say Tiger or Backboard memory stores history, v0.2 stores it locally |
| [`docs/animations/`](docs/animations/), [`docs/ASSETS.md`](docs/ASSETS.md) | 3D characters and the animation pipeline |
| [`docs/TESTING.md`](docs/TESTING.md), [`docs/KNOWN-FAILURES.md`](docs/KNOWN-FAILURES.md) | Test protocol and the owned failure list |

## Contributing

Work on a branch, open a small PR into `main`, and have the other coding seat review it. `npm run verify:quick` must be green. Never commit `.env` files or keys.
