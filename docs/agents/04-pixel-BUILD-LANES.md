# Pixel — Parallel Build Plan for Melvin (logic + Google connector)

**Builds:** `04-pixel-workspace.md` (spec): the Google connector (OAuth, clients, endpoint allowlist), Pixel's 18 tools, email style learning, `GoogleCalendarSource`, the draft registry/tracker/waiting-drafts nudge, Pixel's prompt, and the integration into `createChipCore`.
**Branch:** `pixel/logic`, **created from `chip/logic`** (needs Chip's JobScheduler, FakeCalendar, fakes, `createChipCore`) and rebased on `main` once `contracts/pixel` is merged. The integration lane merges `origin/beaver/logic` (Archie's AgentRuntime, lane R) and, if it has landed, `origin/warden/logic`. Lanes: `lane/pixel-logic-<x>`, worktrees `../ade-wt-pixel-logic-<x>`. PR `pixel/logic → main` **after** `chip/logic`, `beaver/logic`, and `warden/logic`. See `../GIT-WORKFLOW.md`.
**Method:** Hydra flow plan (`C:\Chanuth\hydra\models.json`):
- **Claude Opus 5.5** orchestrator (high; the `GoogleApi` interface and contracts at xhigh).
- **Codex GPT-6 Sol** (high) for the fragile Google pieces: OAuth/tokens, HTTP + Gmail + MIME, Calendar/Drive/Docs/Sheets clients, style learning, the draft-safety tools. **Opus reviews** them.
- **Claude Sonnet 5.5** for prompt and style-learning prompt text, and for integration.
- **Codex GPT-6 Luna** or **AGY Gemini 3.8 Flash High** only for value-floor lanes (fixtures/mocks, simple tools, nudge glue). **AGY never runs unattended**: interactive session, you watch it, deny MCP prompts.
- **Implementers never get MCP access.** This matters more here than anywhere: the Google MCP connectors in this environment can reach **real mailboxes**. Codex always `--ignore-user-config --disable apps`; Claude/AGY lanes deny every MCP prompt.
**When:**
- **Wave 0:** any time after Chip's Wave 1 is merged into `chip/logic` (it is). The human tasks (§0) start at once.
- **Waves 1–2:** need only the frozen `GoogleApi` interface (Wave 0), not AgentRuntime.
- **Wave 3 (I):** after Archie's lane **R (AgentRuntime)** is merged into `beaver/logic`.
**Status:** ✅ APPROVED (Oct 4). **Target:** Pixel P0+P1 working against `FakeGoogle` ≈ 3 h after Wave 0 starts; live against the demo account ≈ 3.5 h.

---

## 0. Human tasks (Melvin, ~35 min; an AI cannot do these; run them in parallel with Wave 0)

| # | Task | Notes |
|---|---|---|
| H1 | Google Cloud project "ADE (Hack Dearborn)": enable the **Gmail, Google Calendar, Google Drive, Google Docs, Google Sheets** APIs | — |
| H2 | OAuth consent screen: **External, Testing**. Add the 5 scopes (`gmail.readonly`, `gmail.compose`, `calendar.events`, `drive.readonly`, `drive.file`). **Test users: all 4 team accounts + the demo account** | Testing-mode tokens expire in 7 days |
| H3 | OAuth client ID type **Desktop app** → `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` in `.env` (never committed). Share privately with Chanuth (app builds) | — |
| H4 | A **dedicated demo Google account** (`DEMO_GOOGLE_EMAIL` in `.env`). Nobody's real inbox | Seeded by `scripts/seed-demo-mailbox.ts` (lane F) |
| H5 | Run lane **G0** (the spike) once the interface exists; then, on the demo laptop, connect Google and click through the "unverified app" screen | Reconnect the morning of the demo |

## 1. Waves

```
WAVE 0  (Opus, ~25 min)
  - contracts/pixel → main (spec §15, EXACTLY): events.ts ArtifactKind += 'google_doc'; types.ts += MemoryWriter, DraftRecord, DraftsLog;
    ipc.ts += AdeApi.disconnectGoogle + IPC.disconnectGoogle ('ade:google:disconnect') + AdeSettings.styleLearnedAt?.
    Tell Chanuth (approves) and Shafeen (waits for MemoryWriter/DraftsLog).
  - pixel/logic from chip/logic; src/main/connectors/google/api.ts = the frozen GoogleApi interface + data types (spec §2.5);
    lane files docs/lanes/PIXEL-<X>.md; worktrees
  - G0 spike (Opus + Melvin, ~15 min, needs H1–H3): one real call each with a throwaway token on the DEMO account:
    documents.create+batchUpdate with drive.file only; documents.get / spreadsheets.values.get with drive.readonly;
    drafts.create via uploadType=multipart with threadId; the openUrl pattern for a draft. Record in docs/sponsor-verify.md (Pixel section)
WAVE 1  (parallel, ~60–75 min)
  F  Fixtures + FakeGoogle + seed script ........ AGY (attended)     Gemini 3.8 Flash High   (floor value)
  H  GoogleHttp + allowlist + Gmail client + MIME  Codex GPT-6 Sol    high                    (floor strong)
  A  OAuth loopback + PKCE + token stores ....... Codex GPT-6 Sol    high                    (floor strong)
  S  Style learning (clean/redact/stats/learn/store) Codex GPT-6 Sol  high                    (floor strong)
  P  Prompt + AgentDefinition + schemas + status ... Claude Sonnet 5.5 high                  (floor strong, writing)
        merge order: F → H → A → P → S   (stagger the three Sol lanes by ~10 min; if Codex hits a limit, STOP and tell Chanuth)
WAVE 2  (parallel, ~50–60 min)
  K  Calendar/Drive/Docs/Sheets clients + Docs builder  Codex GPT-6 Sol  high                (floor strong)
  T1 Gmail tools + registry + attachments ....... Codex GPT-6 Sol    high                    (floor strong)
  T2 Calendar/Drive/Docs/Sheets/style tools + GoogleCalendarSource  Codex GPT-6 Luna high    (floor value)
  N  Drafts log (local) + DraftTracker + waiting rule  Codex GPT-6 Luna high                  (floor value)
        merge order: K → T1 → T2 → N
WAVE 3  (~45 min; needs beaver/logic lane R merged)
  I  Integration + chip-cli scenarios P1–P36 + send probe ... Claude Sonnet 5.5 high (+ Opus review + orchestrator live run)
```

**Subscription load:** Claude: orchestrator, P, then I · Codex: H, A, S, then K, T1, T2, N · AGY: F.

---

## 2. Lane table

| Lane | Builds (spec §) | Engine / model / effort | Floor | Backup | Owned paths | Est. |
|---|---|---|---|---|---|---|
| **F** | Fixtures (§16): demo inbox (12 emails incl. the injection email, hidden-HTML email, long quoted thread, PDF attachment, newsletter), sent corpus (120 messages, one fictional voice), 6 calendar events (a "CS 280 Midterm" ending soon), Drive listing, Doc, Sheet, **canary strings**. `FakeGoogle implements GoogleApi`: in-memory Gmail/Calendar/Drive/Docs/Sheets state, records **every** call in `calls[]`, supports draft create/update/get/list, event create/update, doc create/batchUpdate. `scripts/seed-demo-mailbox.ts`: dry-run by default, `--apply` required, **aborts unless the signed-in address equals `DEMO_GOOGLE_EMAIL`**, uses `users.messages.import` (INBOX / SENT labels; sends nothing) + Calendar `events.insert` for the fixtures | AGY · Gemini 3.8 Flash High · attended | value | Codex GPT-6 Luna high | `tests/fixtures/google/**`, `src/main/testing/fakeGoogle.ts`, `scripts/seed-demo-mailbox.ts`, `tests/fakeGoogle.test.ts` | 60 min |
| **H** | `GoogleHttp` (bearer, refresh-once, 429/5xx backoff with jitter + `Retry-After`, 15 s timeout, redacted logging) + **`allowlist.ts`** (§2.6, ≈ 25 entries; everything else `BLOCKED_REQUEST` before the network) + `GmailApi` real client: search/get message/get thread/attachment/listSent/**create+update draft via `uploadType=multipart`** (JSON with `threadId` + `message/rfc822`)/get draft/list drafts. `mime.ts` (RFC 5322 builder: UTF-8 RFC 2047 subjects, folding, multipart/mixed attachments, reply headers, CR/LF rejection) and `mimeParse.ts` (multipart/alternative, charsets, HTML→text with hidden-text extraction, quote stripping hooks) | Codex · GPT-6 Sol · **high** | strong | Claude Opus 5.5 medium | `src/main/connectors/google/{http,allowlist,gmailClient,mime,mimeParse}.ts`, `tests/google/{http,allowlist,mime,gmailClient}.test.ts` | 70 min |
| **A** | OAuth (§2.3): `auth.ts` (URL, PKCE S256, state), `loopback.ts` (127.0.0.1:0 server, 3-min timeout, closes), `tokenStore.ts` (`SafeStorageTokenStore` with injected `safeStorage`, `MemoryTokenStore`, `DevFileTokenStore`), `googleAuthService.ts` (`connect`, `disconnect` with revoke, `getAccessToken` **single-flight**, scope check, `onNeedsReconnect`), `scripts/google-login.ts` (dev CLI that saves to `.ade-dev/`, gitignored). Injected: `openExternal`, `safeStorage`, `fetch`, `Clock` | Codex · GPT-6 Sol · **high** | strong | Claude Opus 5.5 medium | `src/main/connectors/google/{auth,loopback,tokenStore,googleAuthService}.ts`, `scripts/google-login.ts`, `tests/google/auth.test.ts` | 60 min |
| **S** | Style learning (§6): `cleaner.ts`, `redact.ts`, `stats.ts`, `sampler.ts`, `learner.ts` (`LlmClient` json call, validation + one retry, stats-only fallback, progress via an injected `onProgress`), `styleStore.ts` (local cache, memory mirror through `MemoryApi` + `MemoryWriter`, `sync()` erase-honoring), `compact.ts` (profile → one memory line without examples). Takes `GmailApi.listSent/getMessage` through the interface, so it runs on `FakeGoogle` | Codex · GPT-6 Sol · **high** | strong | Claude Opus 5.5 medium | `src/main/agents/workspace/style/**`, `tests/pixel/style*.test.ts` | 65 min |
| **P** | Prompt (spec §4) + shared RULES block; `AgentDefinition { id:'workspace', maxToolRounds: 8 }`; the 18 tool schemas as JSON exactly as spec §3.2; `status.ts` (the status-string table); the style-learning prompt (spec §6.3) | Claude · Sonnet 5.5 · **high** | strong | Codex GPT-6 Sol medium | `src/main/agents/workspace/{index,prompt,schemas,status}.ts`, `src/main/agents/workspace/style/prompt.ts`, `tests/pixel/prompt.test.ts` | 40 min |
| **K** | `CalendarApi` (always `sendUpdates:'none'`), `DriveApi` (structured `q` builder + escaping, export, download), `DocsApi` (`create`, `batchUpdate`, `getEndIndex`), `SheetsApi` (`info`, `getValues`), **`docsMarkdown.ts`** (the Markdown subset → `batchUpdate` requests; UTF-16 indices; https-only links) | Codex · GPT-6 Sol · **high** | strong | Claude Opus 5.5 medium | `src/main/connectors/google/{calendarClient,driveClient,docsClient,docsMarkdown,sheetsClient}.ts`, `tests/google/{calendar,drive,docs,docsMarkdown,sheets}.test.ts` | 60 min |
| **T1** | Gmail tools (spec §3): `gmail_search/read_thread/digest/list_drafts/ask_attachment/create_draft/reply_draft/update_draft` with `inspect`/`preview`/`riskFor`, the screen calls (raw HTML then extracted text), recipient derivation, header-injection checks, attachment checks via Archie's `safePath` (import; fake until merged), `registry.ts` (draft/doc ownership), the temp-file helper (`withTempFile`, always deleted), `redactEventArgs` helper | Codex · GPT-6 Sol · **high** | strong | Claude Opus 5.5 medium | `src/main/agents/workspace/{gmailTools,registry,tempFile}.ts`, `src/main/runtime/redactArgs.ts`, `tests/pixel/gmail*.test.ts` | 65 min |
| **T2** | `cal_*`, `drive_*`, `docs_*`, `sheets_read`, `style_get` tools; **`GoogleCalendarSource`** (`src/main/connectors/google/calendarSource.ts`: cache, screened titles, `[]` when disconnected, throws on network errors) | Codex · GPT-6 Luna · **high** | value | Codex GPT-6 Sol medium | `src/main/agents/workspace/{calendarTools,driveTools,docsTools,sheetsTools,styleTool}.ts`, `src/main/connectors/google/calendarSource.ts`, `tests/pixel/{cal,drive,docs,sheets}*.test.ts` | 55 min |
| **N** | `LocalDraftsLog implements DraftsLog` (over the registry), `DraftTracker` (§9.3), `DraftsWaitingRule` (§9.2; injected clock, `NudgeEngine.schedule`, `NudgeStore.findByEvent`), composite log (local first, Tiger copy optional) | Codex · GPT-6 Luna · **high** | value | Codex GPT-6 Sol medium | `src/main/agents/workspace/drafts.ts`, `tests/pixel/drafts*.test.ts` | 40 min |
| **I** | Integration (§3 I) | Claude · Sonnet 5.5 · **high** | strong | Codex GPT-6 Sol medium | `src/main/agents/workspace/{pixelRunner,probe}.ts`, `src/main/chipCore.ts` (Pixel wiring only), `src/main/runtime/agentRuntime.ts` (one marked hook: `redactEventArgs`), `scripts/chip-cli` scenarios, `tests/scenarios/pixel/**` | 45 min |

**No overlap with other plans:** Chip owns `runtime/{jobs,presence,mood,nudges,history}.ts` and `agents/chipmunk/**`; Archie owns `agentRuntime.ts`, `connectors/fs/**`, `agents/beaver/**`; Warden owns `src/main/wolf/**`; Shafeen owns `sponsors/**`, `store/**`, `voice/**`, `scripts/create-assistants.ts`, `memory-rules.ts`; the app shell owns `src/renderer/**`, `src/main/shell|ipc|fake/**`. Pixel's only edits outside its own paths are lane I's marked hook points, done **after** those owners have merged.

**Notes for lanes:**
- Every module takes its dependencies **injected** (`fetch`, `Clock`, `openExternal`, `safeStorage`, `LlmClient`, `MemoryApi`/`MemoryWriter`, `DocumentsApi`, `InjectionScreen`, `PathPolicy`, `NudgeEngine`) so tests run under plain Node on the fake clock.
- **Tests never touch a real mailbox, calendar, or Drive.** Only `FakeGoogle` and a fake `fetch`. The single exception is the orchestrator's live run (P36) on the demo account.
- Until Warden's real screen lands, `InjectionScreen` is a pass-through stub that returns `wrapped` as `<untrusted source="…">…</untrusted>`; the Warden-merge step swaps it.
- Lane H and T1 are the safety-critical lanes: **no `send`, `permissions`, or `.delete(`** anywhere outside the allowlist's deny table (the grep test P3).

---

## 3. Lane specs (what each `docs/lanes/PIXEL-<X>.md` says)

### F: Fixtures + FakeGoogle + seed (AGY, attended)
- **Read:** spec §2.5, §16.
- **Build:** as the table. Every body, doc, and cell contains a unique `CANARY-<n>` string. The injection email's **first line** is the injection so its snippet trips the screen. `FakeGoogle.calls` is an array of `{ api, method, args }`.
- **Tests:** `FakeGoogle` behaves (draft round trip, thread headers, event create stores `sendUpdates:'none'`); `makeSandbox()` from Archie's lane F for attachment tests.
- **STOP if:** the seed script could run against a non-demo account (the address check must be the first thing it does).

### H: GoogleHttp + Gmail client (Codex Sol high)
- **Read:** spec §2.5, §2.6, §3.3; `docs/sponsor-verify.md` (Pixel section from G0).
- **Tests:** P3, P4, P5, P31, and the Gmail half of P2. Round-trip the MIME builder through the parser.
- **STOP if:** drafts cannot carry `threadId` with the upload endpoint (report the real response; G0 should have caught it).
- **Review:** Opus reads the diff (allowlist and MIME are security-critical).

### A: OAuth + tokens (Codex Sol high)
- **Read:** spec §2.2–§2.4.
- **Tests:** P1, P2, P35 (service part). Fake token endpoint, fake browser, fake `safeStorage`.
- **STOP if:** `google-auth-library` cannot do PKCE with a desktop client (then do the token exchange with `fetch` by hand).
- **Review:** Opus reads the diff.

### S: Style learning (Codex Sol high)
- **Read:** spec §6, §13.
- **Tests:** P13, P14 (store part). Redaction cases: emails, phones, URLs, digit runs, the recipient's name. Quote-stripping cases: Gmail, Outlook, `>`-style, forwards, mobile footers, a recurring signature.
- **STOP if:** the cleaned corpus yields fewer than 15 usable emails (report; the fixture is wrong).

### P: Prompt + definition (Claude Sonnet 5.5 high)
- **Read:** spec §1, §3, §4, §6.3, §12.
- **Tests:** snapshots; every schema is valid JSON Schema; tool names unique; no name collides with another agent's tools (`fs_*`).

### K: Other Google clients + Docs builder (Codex Sol high)
- **Read:** spec §2.5, §3.3 (`docs_create`, `drive_search`).
- **Tests:** P15 (client half), P19, P22 (builder half), P24 (client half). **UTF-16 test:** a heading containing emoji and CJK followed by a bullet list; style ranges must land on the right characters.
- **STOP if:** `batchUpdate` ranges are off on non-BMP text after the fix (report the failing case).

### T1: Gmail tools (Codex Sol high)
- **Read:** spec §3.3, §5, §7, §13.
- **Tests:** P6–P12, P21 (attachment part), P25 (Gmail), P27 (Gmail part). Includes the **header-injection** and **recipient-derivation** cases.
- **Review:** Opus reads the diff (this is the "can Pixel be tricked" lane).

### T2: Other tools + CalendarSource (Codex Luna high)
- **Read:** spec §3, §9.1.
- **Tests:** P15–P24 (tool half), P18, P20, P21 (Drive part), P25. The C12 nudge scenario from Chip's tests runs with `GoogleCalendarSource` over `FakeGoogle`.

### N: Drafts (Codex Luna high)
- **Read:** spec §5, §9.2, §9.3.
- **Tests:** P28, P29.

### I: Integration (Claude Sonnet 5.5 high)
- **Read:** spec §2, §7, §12, §13; Archie spec §14; the merged `agentRuntime.ts`; Warden's `createWarden` if merged.
- **Build:**
  1. Register Pixel in AgentRuntime (`workspace`); memory modes per job kind; `MemoryWriter`/`DocumentsApi` from Shafeen's kits (fakes until merged).
  2. `createChipCore`: `calendar: GoogleCalendarSource` when connected, `FakeCalendar` otherwise; start `DraftTracker` and `DraftsWaitingRule`.
  3. RealCore hooks (for the app shell's adapter): `connectGoogle`, `disconnectGoogle`, `learnEmailStyle` (with the consent flag), writing `AdeSettings.googleEmail` and `styleLearnedAt`.
  4. `redactEventArgs` at the one marked hook where `agentRuntime.ts` emits `tool.request`.
  5. `PixelRunner` (wraps the specialist runner by composition): in **demo mode**, a task for `workspace` that asks to send/forward/share first runs the **send probe** (`probe.ts`): a `gate.review` of a synthetic `gmail_send_draft` `external` call, emitting the real `tool.request`/`wolf.verdict`/Warden line; nothing is executed. Off outside demo mode.
  6. chip-cli: `/scenario P1…P36`, `/google login` (dev token), `/fixture` (point Pixel at `FakeGoogle`).
- **Done when:** `npm test` on `pixel/logic` is green (P1–P35 + all Chip tests + all Archie tests), P33 runs, and the orchestrator's **live run** (P36) passes on the demo account.
- **Review:** Opus reads the diff.

---

## 4. Audit + merge (orchestrator)
1. Re-run each lane's tests yourself.
2. **Grep the diff** for: real user paths; `send`/`permissions`/`.delete(` outside the allowlist's deny table; secrets, tokens, `.env`, `.ade-dev/`; any `console.log` of bodies.
3. `git diff --stat pixel/logic...lane/pixel-logic-<x>`: owned paths only.
4. Merge into `pixel/logic`: **F → H → A → P → S**, then **K → T1 → T2 → N**, then (after `beaver/logic` has lane R) `git merge origin/beaver/logic` → **I**. `npm test` after each; push.
5. **Cross-vendor review:** H, A, S, K, T1 (Codex) are reviewed by Opus; I (Sonnet) by Opus.
6. **Escalation (Hydra: effort before band):** one effort notch up on the same model → the backup column → fix the spec. Never move a strong-floor lane to AGY. If Codex hits a usage limit: **stop and report to Chanuth** (no cross-subscription backup).
7. When Shafeen posts "Pixel sponsor kit ready": `git merge origin/pixel/sponsors`; swap the in-memory pieces for `TigerDraftsLog` (composite) and `MemoryWriter`. When Warden is on `main`: swap the screen stub for the real `InjectionScreen` and run P26 with the real gate.

## 5. Timeline (from Pixel start)
| Clock | Milestone |
|---|---|
| +0:00 | H1–H4 started by Melvin; Wave 0 begins |
| +0:25 | `contracts/pixel` PR open; `GoogleApi` interface frozen; lanes F, H, A, S, P dispatched (staggered) |
| +0:40 | G0 spike results recorded (scope fallbacks decided) |
| +0:45 → +1:30 | Chanuth reviews + merges the contracts PR; rebase `pixel/logic` |
| +1:40 | Wave 1 merged (H, A, S Opus-reviewed); K, T1, T2, N dispatched |
| +2:40 | Wave 2 merged |
| +2:40 → | Wait for Archie lane R if not merged |
| +3:20 | **Pixel done offline**: P1–P35 green; live run P36 on the demo account +0:20 |

**If time runs short, cut in this order** (spec §18): P2 tools → P1 tools (not the allowlist or the tests for what ships) → the drafts nudge. Never cut H, A, S, T1, the allowlist, or the privacy canary test.

## 6. Handoffs to other plans (not Pixel-owned paths)
- **App shell (Chanuth's Codex):**
  - Onboarding step 2 (`connectGoogle`) and step 4 (consent text from spec §6.1, progress from the `agent.status` events, result "Learned from N emails"); Settings: connected email, **Disconnect** (`disconnectGoogle`), **Re-learn my style**, "Style learned" from `styleLearnedAt`.
  - Tray: `google_doc` → "Open in Docs"; `email_draft` → "Open in Gmail"; open only `https` URLs on `mail.google.com`, `docs.google.com`, `calendar.google.com`, `drive.google.com`.
  - Pixel inspect card: "Google: connected as …" line; the Memories tab shows the style line.
  - Pixel character: `character.json` `"clipMap": { "Work": "Write" }`; the procedural clips listed in `animations/pixel-actions.md`.
  - `FakeCore` scripts `email-digest` and `warden-block` keep working unchanged.
- **Warden lane G (spec tweak, if Chanuth approves decision 11):** evaluate W1's name-segment test before W10; add Pixel's rows to `rule-matrix.json` (P26).
- **Chip:** no change. The prompt, acks (📬 "Ooh, mail duty!"), and `CalendarSource` plug already exist. Optional later: unread counts in the daily nudge.
- **Scout / Swarm plans:** may use `docs_create` (via Pixel) and the same `CalendarApi`.
