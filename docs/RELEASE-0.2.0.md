# ADE 0.2.0 release notes

Main at `d38d0c8` (Nov 2, 2026): PRs #53 to #62. This file describes what the code does now. Older docs written at Hack Dearborn (Oct 4) describe the hackathon build; where they disagree, this file wins.

## Where things run

| Part | Where | Notes |
|---|---|---|
| The AI's thinking (Chip and every animal) | **Backboard** (cloud) | Default model Google Gemini 2.5 Flash per animal; changeable in Settings. Needs internet and a Backboard key. **Temporary**: decided Nov 2, Backboard is replaced by the user's own Claude Code (first), Codex or Gemini CLI; being built, not in 0.2. |
| Archie reading PDF, Word, slides and sheets (`fs_ask_file`) | **Backboard** document indexing | Plain text files are read locally. |
| Memories, Timeline, Audit, Pulse, Replay, chat history | **Local**: one SQLite file, `%APPDATA%\ADE\ade.db` | Always on. Backboard memory is off; Tiger is not used. Events are kept 90 days. |
| Voices and sounds | ElevenLabs (optional key) | Shipped lines play without a key. |
| Gmail, Calendar, Drive (Pixel) | Google OAuth | Needs `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`. |
| Tiger Data | Optional, off by default | A missing or incomplete `TIGER_DATABASE_URL` no longer stops the real core. |

## What changed

- **Setup screen** (#55): a fresh install with no Backboard key opens ADE Setup. Paste your own key, verify it, choose **Save and create assistants**, restart. Or try the offline demo.
- **Local core** (#57, wired in #61): memories, events, audit and chat threads live in `ade.db`. Relevant memories go into each turn; new facts are learned with each animal's own rules; Warden never learns.
- **Talk while an animal works** (#58): "Archie, skip the PDFs" during a job goes straight to that job at its next step, with no model call; Chip answers "Telling Archie." A note the job never read goes back to Chip, so nothing is lost.
- **Chip always answers** (#61): a Tiger URL without a password used to force the offline demo core; now Tiger just stays off.
- **Easy quit** (#61): ✕ in the Hub header, tray icon (Show Hub, Hide animals, Reset animal spots, Quit ADE), and Ctrl+Shift+Q. DevTools opens only with `--devtools`.
- **Speech cloud** (#61): shows the whole line the animal says (up to 6 short lines, 4 to 12 s), not a 2-word tag.
- **Archie tidy-ups** (#61): if Archie makes a plan and does not apply it, ADE asks him once more, so Warden's approval card always appears. Empty model replies get one retry.
- **Drag the animals** (#62): press and move an animal to drag it along the ground; the drop spot becomes its home and is remembered. Tray > **Reset animal spots** sends everyone back.
- **ADE account** (#60, in #61): email-code sign-in for install and weekly-active counts. Off until `account.config.ts` has the Supabase URL and anon key.
- Demo text encoding fixed; new installs default to Gemini 2.5 Flash (#53).

## Checked

- Typecheck clean. Full suite: only the failures listed in `docs/KNOWN-FAILURES.md` (they pass when their files run alone, except A14).
- Live on the real core with Gemini 2.5 Flash, three runs in a row on main: Chip answers and knows the time; a fact is stored in `ade.db` and deleted; "Archie, leave the PDFs" reaches the job; Warden's card; 14 files moved into 5 folders; undo restores all 14; "Send it" refused and in the Audit log.
- `ADE Setup 0.2.0.exe` builds and the packaged app opens ADE Setup on a machine with no keys.

## Current limits

- **Not offline**: the AI and document reading need Backboard and internet.
- **Pixel** needs Google OAuth client credentials and, for a new user, Google's app verification.
- **Voices**: each animal needs its own `EL_VOICE_*` ID; without it that animal is silent (text still shows).
- **Weather**: ADE has no weather source; Chip can invent a forecast if asked. Keep weather out of demos.
- Dragging works along the ground only, not anywhere on screen.
- The installer is not code signed, so Windows shows an unknown-publisher warning.

## Manual clean-install check on Windows

Use a fresh Windows user profile or VM with no ADE settings or keys.

1. Install `ADE Setup 0.2.0.exe` and launch ADE. Confirm **ADE Setup** opens before the forest and Hub.
2. Choose **Try the offline demo instead**. Confirm the forest and Hub open; trigger the frustration and Warden approval demos; check bubbles and approval text read correctly.
3. Close ADE (✕ or Ctrl+Shift+Q) and launch again. In Setup, paste a Backboard key you own and select **Verify**. Confirm a balance appears and the key is never shown in full.
4. Select **Save and create assistants**, wait for each to show **ready**, then **Restart ADE to finish**. Confirm Chip answers a text message.
5. Tell Chip a fact, then open **Memories**: it is listed; delete it. Open **Timeline** and **Audit**: today's events are there.
6. In Settings, confirm Gemini 2.5 Flash for a new install; change one animal's model, restart, and confirm it persists.
7. Drag an animal along the ground; restart; it is still there. Tray > **Reset animal spots** sends it home.

Never paste keys, connection strings or certificate contents into a test report.

## Account

When ADE account setup is enabled, first run asks for an email and a six-digit sign-in code before the Backboard step. ADE stores the email, a random device identifier, app version, and first and last use timestamps for install and active-user counts. It does not send files, mail, memories or desktop content to the account service. In Settings > Account, **Sign out** removes the local session and stops the heartbeat.
