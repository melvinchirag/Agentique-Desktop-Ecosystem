# ADE — Copy-Paste Prompts

**How to use:** find your section and copy the whole prompt block into the AI named above it. Run it **inside your local clone of this repo** (pull `main` first).
These prompts *start* each person's build. The AI then reads the plan files and drives the rest.

| Who | Paste into | Section |
|---|---|---|
| Melvin | Claude Code (Opus 5.5, effort high), repo root | [Melvin — Chip logic orchestrator](#melvin--chip-logic-orchestrator) |
| Shafeen | Claude Code (Opus 5.5, effort high), repo root | [Shafeen — Chip sponsor tech orchestrator](#shafeen--chip-sponsor-tech-orchestrator) |
| Zarin | Codex, repo root | [Zarin — push your existing files](#zarin--push-your-existing-files) |
| Chanuth | Codex (GPT-6 Astra, effort high), repo root | [Chanuth — App shell orchestrator](#chanuth--app-shell-orchestrator) |

**Safety rules for everyone's AI:** never commit `.env` or keys · never work on `main` · **deny any MCP/connector tool call** an AI asks to make (they can touch real email/calendar/drive) · Codex always runs with `--ignore-user-config --disable apps`.

---

## Melvin — Chip logic orchestrator
*Paste into: Claude Code, model **Opus 5.5**, `/effort high`, opened at the repo root.*

```text
You are the ORCHESTRATOR for building Chip's logic in the ADE (Agentique Desktop Ecosystem) repo.
You plan, write lane specs, dispatch AI implementer lanes, audit their work, and merge. You do NOT
implement lanes yourself, except the small Wave 0 items your plan assigns to you and fixes of a few lines.

READ FIRST, IN THIS ORDER (all in this repo):
1. docs/DECISIONS.md                       (every decision; wins if docs disagree)
2. docs/agents/01-chip-orchestrator.md     (Chip spec v3.1, the thing being built)
3. docs/agents/01-chip-BUILD-LANES.md      (YOUR plan: waves, lanes, models, merge order)
4. docs/ARCHITECTURE.md section 3          (shared contracts)
5. docs/GIT-WORKFLOW.md                    (branches)

THEN DO WAVE 0 EXACTLY AS 01-chip-BUILD-LANES.md section 3 SAYS:
- Plain TypeScript setup (NO Electron; the app shell is built separately), vitest, tsx.
- src/shared/* from ARCHITECTURE.md section 3, and src/main/runtime/types.ts with EVERY interface in
  Chip spec section 7, including the sponsor plugs Shafeen implements (LlmClient, MemoryApi, EventSink,
  HistoryStore, NudgeStore, TigerQueries, VoiceService, ...).
- EventBus + its test.
- Put ONLY the contracts/setup on branch "contracts/shared" and open a PR into main titled
  "contracts: shared types for Chip". Tell me the PR link immediately; Shafeen is waiting on it.
- After I merge it: create branch chip/logic from main, write one lane file per lane in
  docs/lanes/CHIP-<X>.md (objective, owned paths, spec sections, steps, tests, STOP conditions),
  and create a git worktree per Wave 1 lane: git worktree add ../ade-wt-chip-logic-<x> -b lane/chip-logic-<x> chip/logic

DISPATCH: for each lane, give me the EXACT command or instruction to launch it, using the model,
effort, and engine in the plan's lane table (Codex lanes piped through stdin with
--ignore-user-config --disable apps; Claude/AGY lanes as interactive sessions in the worktree).
I launch them. Lane B is NOT yours (it moved to Shafeen).

AUDIT + MERGE (plan section 7): re-run each lane's tests yourself; check git diff --stat touches only
owned paths and has no secrets; merge lanes into chip/logic one at a time in the order
C -> D -> E -> H -> A, then G -> I, then J1; run npm test after each merge; push chip/logic.
When Shafeen announces "sponsor kit ready", git merge origin/chip/sponsors into chip/logic and run the live test.

RULES: never commit .env or keys. Never edit src/shared or types.ts after Wave 0 without asking me.
Deny MCP tool calls. If the spec is unclear or wrong, STOP and ask me; don't guess.
After every step, report status as a short table: lane | state | next action.
```

---

## Shafeen — Chip sponsor tech orchestrator
*Paste into: Claude Code, model **Opus 5.5**, `/effort high`, opened at the repo root.*

```text
You are the ORCHESTRATOR for building Chip's SPONSOR TECH (Backboard, ElevenLabs, Tiger Data) in the
ADE (Agentique Desktop Ecosystem) repo. You plan, write lane specs, dispatch AI implementer lanes,
audit, and merge. You do NOT implement lanes yourself, except fixes of a few lines.

READ FIRST, IN THIS ORDER (all in this repo):
1. docs/DECISIONS.md                              (every decision; wins if docs disagree)
2. docs/SPONSORS.md                               (exactly how each sponsor is used: Chip first)
3. docs/agents/01-chip-SPONSOR-LANES-SHAFEEN.md   (YOUR plan: lanes S1-S6, models, merge order)
4. docs/agents/01-chip-orchestrator.md section 7  (the interfaces you implement)
5. docs/GIT-WORKFLOW.md                           (branches)

STEP 1 — HUMAN TASKS: walk me through getting the keys (plan section 2): BACKBOARD_API_KEY,
ELEVENLABS_API_KEY (tell me how to check whether the plan is paid, for Music), TIGER_DATABASE_URL
(create a free Tiger Cloud service). I paste them into .env myself. Confirm .env is gitignored.
Never print or commit key values.

STEP 2 — START NOW (these don't need Melvin's contracts): create branch chip/sponsors from main,
write lane files docs/lanes/SHAF-<S#>.md for S2, S4, S5a, S6 (objective, owned paths, steps, tests,
STOP conditions), create a worktree per lane:
  git worktree add ../ade-wt-chip-sponsors-<s#> -b lane/chip-sponsors-<s#> chip/sponsors
and give me the EXACT launch command or instruction for each, using the model, effort, and engine
in the plan's lane table (Codex lanes piped through stdin with --ignore-user-config --disable apps;
Claude/AGY lanes as interactive sessions in the worktree). I launch them.
Do S2 (voices) for Chip FIRST and tell me when the previews are ready; the team picks Chip's voice.

STEP 3 — WHEN MELVIN'S CONTRACTS PR ("contracts: shared types for Chip") IS MERGED INTO MAIN:
rebase chip/sponsors on main, then set up and dispatch S1, S3, and S5b (after S5a merges).
Check with: git fetch && git ls-tree origin/main src/main/runtime/types.ts

AUDIT + MERGE (plan section 7): re-run each lane's tests yourself; diff touches only owned paths
and has NO keys or connection strings; Opus reviews S1 and S5b code; merge into chip/sponsors one at a time:
S6 -> S5a -> S1 -> S5b -> S3 -> S2 -> S4; run npm test after each; push.

HANDOFF (plan section 6): write docs/handoff/chip-sponsors.md, make scripts/sponsor-smoke.ts pass,
then tell me to post "sponsor kit ready" with the commit hash, and open PR chip/sponsors -> main.

RULES: never edit src/shared or src/main/runtime/types.ts (Melvin owns them; ask instead).
Deny MCP tool calls. If the spec is unclear or a real API differs from the docs, STOP and ask me.
After every step, report status as a short table: lane | state | next action.
```

---

## Zarin — push your existing files
*Paste into: **Codex**, opened in the folder where you want the repo (it clones it for you). Replace `<PATH TO MY FILES>` first.*

```text
Help me save my existing 3D files for the ADE project to GitHub on my own branch. Do these steps and
show me the output of each command. Do not touch any other files.

1. Make sure Git LFS is installed and set up:  git lfs install
   (If git-lfs is missing, tell me how to install it on my OS and stop.)
2. Clone the repo and enter it:
     git clone https://github.com/melvinchirag/Agentique-Desktop-Ecosystem.git
     cd Agentique-Desktop-Ecosystem
3. Create my branch:  git switch -c chip/graphics
4. My files are here: <PATH TO MY FILES>
   Copy them into the repo:
   - Blender source files (.blend) for the chipmunk -> art/chipmunk/
   - Any other animal's .blend -> art/<animal>/ using these folder names:
     chipmunk, wolf, workspace, beaver, eagle, ants, butterfly, nightingale
   - Exported models (.glb/.gltf) for the chipmunk -> src/renderer/public/characters/chipmunk/default/
     (name the main one model.glb)
   - Anything else (textures, references, renders) -> art/<animal>/extra/
   Don't copy .blend1/.blend2 backup files.
5. Check that .blend files are tracked by LFS:  git lfs track   (should list *.blend)
6. Commit and push:
     git add art src
     git commit -m "chip(graphics): initial files from Zarin"
     git push -u origin chip/graphics
7. Then list every file you pushed with its size, and confirm with: git lfs ls-files
If any single file is over 100 MB, STOP before pushing and tell me which one.
```
*After pushing, tell Chanuth. Your full plan gets adjusted once we've seen your files.*

---

## Chanuth — App shell orchestrator
*✅ Approved (Oct 4). If Codex hits a usage limit: STOP and tell Chanuth.*
*Paste into: **Codex**, model **GPT-6 Astra**, effort **high**, at the repo root, started with `codex -m gpt-6-astra -c model_reasoning_effort="high" --ignore-user-config --disable apps`.*

```text
You are the ORCHESTRATOR for building the ADE APP SHELL: the animals living directly on the real
Windows desktop (transparent, click-through, always-on-top overlay) plus the Agent Hub window.
It is NOT a windowed app. You plan, write lane specs, dispatch implementer lanes, audit, and merge.
You do NOT implement lanes yourself, except Wave 0 setup and fixes of a few lines.
Builders are Codex (GPT-6 Sol / Luna) and AGY (Gemini 3.8 Flash High) only.

READ FIRST, IN THIS ORDER (all in this repo):
1. docs/DECISIONS.md                              (every decision; wins if docs disagree)
2. docs/app-shell/00-APP-SHELL-SPEC.md            (what you're building)
3. docs/app-shell/01-APP-SHELL-BUILD-LANES.md     (YOUR plan: X0 spike, waves, lanes, models, merge order)
4. docs/ARCHITECTURE.md section 3                 (locked contracts: BiomeEvent, AdeApi, IPC channels)
5. docs/ASSETS.md + docs/animations/chip-actions.md (clip names the characters play)
6. docs/GIT-WORKFLOW.md                           (branches)

STEP 1 — DONE: Chanuth ran X0 on his laptop on Oct 4. Use the results in both app-shell docs; the
defaults are pointer forward, always-on-top floating, toolbar off, and software-GPU settings are
devicePixelRatio 1 plus the existing FPS and triangle budgets. Alt-Tab visibility stays a W2b manual
check. Do not repeat the spike.

STEP 2 — when Melvin's PR "contracts: shared types for Chip" is merged into main
(check: git fetch && git ls-tree origin/main src/shared): do Wave 0 exactly as the build-lanes
file section 3 says: branch app/shell from main, add Electron on top of the existing package.json,
freeze the shell interfaces, wire ade:event to both windows, write docs/lanes/SHELL-L1..L8.md,
create one worktree per lane: git worktree add ../ade-wt-app-shell-<x> -b lane/app-shell-<x> app/shell

DISPATCH: for each lane give me the EXACT launch command or instruction using the model, effort,
and engine in the lane table (Codex lanes piped through stdin with --ignore-user-config --disable apps;
AGY lanes as interactive sessions in the worktree, deny all MCP prompts). Stagger Codex lanes
(L1, L2, L3 first; L4, L7 ten minutes later). I launch them.

AUDIT + MERGE (build-lanes section 7): re-run each lane's tests and its manual checks; diff touches
only owned paths and has no secrets; merge into app/shell one at a time:
L2 -> L1 -> L3 -> L7 -> L4 -> L6 -> L5 -> L8, then W2a -> W2b; npm test + npm run dev after each; push.
Finish: run every acceptance check in spec section 16, then open PR app/shell -> main.

RULES: never edit src/shared/* (Melvin owns it). Never commit .env or keys. Never implement Chip,
sponsor, or agent logic: the shell runs on FakeCore until Lane J2. If the spec is unclear or a
Windows behavior differs, STOP and ask me. After every step, report a short table:
lane | state | next action.
```

---

# Archie (beaver, file manager) — ✅ approved (Oct 4); Melvin starts after Chip's Wave 1 merges, Shafeen after Chip's sponsor kit

| Who | Paste into | Section |
|---|---|---|
| Melvin | Claude Code (Opus 5.5, effort high), repo root | Melvin — Archie logic orchestrator |
| Shafeen | Claude Code (Opus 5.5, effort high), repo root | Shafeen — Archie sponsor tech |
| Zarin | Codex, repo root | Zarin — Archie graphics |

## Melvin — Archie logic orchestrator
*Paste into: Claude Code, **Opus 5.5**, `/effort high`, repo root. Start once Chip's Wave 1 is merged into `chip/logic`.*

```text
You are the ORCHESTRATOR for building ARCHIE (the beaver file-manager agent, id "beaver") AND the
generic AgentRuntime that every specialist animal will reuse, in the ADE repo. You plan, write lane
specs, dispatch AI lanes, audit, and merge. You don't implement lanes yourself (only Wave 0 items
and few-line fixes).

READ FIRST, IN THIS ORDER:
1. docs/DECISIONS.md
2. docs/agents/02-archie-files.md          (Archie spec: tools, safePath, organize/undo, AgentRuntime §14)
3. docs/agents/02-archie-BUILD-LANES.md    (YOUR plan: waves, lanes R P D F T O I, models, merge order)
4. docs/agents/01-chip-orchestrator.md     (sections 3, 4.1, 7, 8, 16: jobs, help jobs, output format)
5. docs/GIT-WORKFLOW.md

WAVE 0:
- AFTER my Chip contracts PR (contracts/shared) is merged, open a small follow-up contracts PR
  (branch contracts/archie -> main) with ONLY the Archie contract changes in spec section 15:
  ArtifactKind 'file_note', ToolContext.threadId, and FileOp (op += trash|sweep) / FileOpsJournal
  (+ trashBatchesOlderThan, markSwept) / DocumentsApi in src/main/runtime/types.ts.
  Tell me the PR link; Shafeen waits on it.
- After it merges: create branch beaver/logic FROM chip/logic, rebase it on main, write lane files
  docs/lanes/ARCHIE-<X>.md, and make a worktree per lane:
  git worktree add ../ade-wt-beaver-logic-<x> -b lane/beaver-logic-<x> beaver/logic

DISPATCH: give me the EXACT launch command or instruction per lane, using the model, effort, and
engine in the plan's lane table (Codex via stdin with --ignore-user-config --disable apps;
Claude/AGY interactive in the worktree). I launch them.

AUDIT + MERGE: re-run every lane's tests yourself; REJECT any test that touches real user folders
(only the makeSandbox() fixture is allowed); diff = owned paths only, no secrets; you (Opus) review
lanes R and O before merging. Merge into beaver/logic: F -> P -> D -> R, then T -> O, then I.
npm test after each; push. When Shafeen posts "Archie sponsor kit ready", merge origin/beaver/sponsors
and switch fs_ask_file + the journal to the real implementations.

RULES: never commit .env; deny MCP tool calls; never run Archie's tools against my real Desktop,
Documents, or Downloads. Use the fixture. STOP and ask on spec conflicts. Report a status table
(lane | state | next) after every step.
```

## Shafeen — Archie sponsor tech
*Paste into: Claude Code, **Opus 5.5**, `/effort high`, repo root. Start after Chip's sponsor kit is handed off.*

```text
You are the ORCHESTRATOR for ARCHIE's sponsor tech (Backboard documents, ElevenLabs voice + sounds,
Tiger file-ops journal) in the ADE repo. Plan, write lane specs, dispatch, audit, merge. Don't
implement lanes yourself except few-line fixes.

READ FIRST:
1. docs/DECISIONS.md
2. docs/agents/02-archie-SPONSOR-LANES-SHAFEEN.md   (YOUR plan: lanes B1 V1 T1 W1)
3. docs/agents/02-archie-files.md sections 4.1 (fs_ask_file), 5 (journal), 7 (memory rules), 9 (voice/SFX), 15 (contracts)
4. docs/SPONSORS.md (Archie rows) and docs/agents/01-chip-SPONSOR-LANES-SHAFEEN.md (tooling you reuse)

SETUP: wait until Melvin's Archie contracts PR (contracts/archie: FileOpsJournal, DocumentsApi in types.ts) is merged
into main (check: git fetch && git show origin/main:src/main/runtime/types.ts | findstr DocumentsApi).
W1 and V1 can start before that. Branch beaver/sponsors from main; lane files docs/lanes/ARCHIE-SP-<X>.md;
worktrees: git worktree add ../ade-wt-beaver-sponsors-<x> -b lane/beaver-sponsors-<x> beaver/sponsors

DISPATCH each lane with the exact model, effort, and engine from the lane table (Codex via stdin with
--ignore-user-config --disable apps; Claude/AGY interactive). I launch them. For V1, tell me when
Archie's voice previews are ready so the team can pick one.

AUDIT + MERGE into beaver/sponsors: W1 -> T1 -> B1 -> V1; you review T1; no keys in diffs; npm test
after each; push. Then run the smoke test in plan section 2, tell me to post
"Archie sponsor kit ready: <commit>", and open PR beaver/sponsors -> main.

RULES: never edit src/shared or types.ts (Melvin owns them); deny MCP tool calls; STOP and ask if a
real API differs from the docs. Status table after every step.
```

## Zarin — Archie graphics
*Paste into: **Codex**, repo root.*

```text
Help me build and save ARCHIE THE BEAVER's 3D model and animations for the ADE project.

1. Read docs/animations/Archie_Animations_for_Zarin.txt (my full list) and docs/ASSETS.md section 2
   (export rules). Summarize the Tier 1 list for me in 10 lines.
2. Git: git switch main && git pull && git switch -c beaver/graphics && git push -u origin beaver/graphics
3. Make sure tools/blender/required_clips.json has the "beaver" entry with EXACTLY the clip names
   from Archie_Animations_for_Zarin.txt (loop flags + tiers). Update it if needed.
4. When I say "check", run:
     blender -b art/beaver/beaver.blend --python tools/blender/check_character.py -- beaver
   and explain any FAIL lines in plain words.
5. When I say "export", run:
     blender -b art/beaver/beaver.blend --python tools/blender/export_character.py -- beaver
6. When I say "save", commit and push only art/beaver, src/renderer/public/characters/beaver, and
   tools/blender with a message like "beaver(graphics): Tier 1 clips ...".
Never touch other folders. Stop and tell me if any file is over 100 MB.
```

---

# Warden (wolf, security) — ⏳ PENDING APPROVAL: use only after Chanuth approves the Warden plan

Branches use the character name: `warden/logic`, `warden/sponsors`, `warden/graphics`, lanes `lane/warden-<track>-<x>`. The agent id in code and folders stays `wolf`.

| Who | Paste into | Section |
|---|---|---|
| Melvin | Claude Code (Opus 5.5, effort high), repo root | Melvin — Warden logic orchestrator |
| Shafeen | Claude Code (Opus 5.5, effort high), repo root | Shafeen — Warden sponsor tech |
| Zarin | Codex, repo root | Zarin — Warden graphics |

## Melvin — Warden logic orchestrator
*Paste into: Claude Code, **Opus 5.5**, `/effort high`, repo root. Start any time after Chip's Wave 1 is merged (can overlap Archie). Use only after the Warden plan is approved.*

```text
You are the ORCHESTRATOR for building WARDEN (the wolf security agent, id "wolf") in the ADE repo:
the real WardenGate (rules W0-W16), Approvals, the InjectionScreen, Warden's lines + speaker, and the
swap that replaces Chip's StubWardenGate. You plan, write lane specs, dispatch AI lanes, audit, and
merge. You don't implement lanes yourself (only Wave 0 items and few-line fixes).

READ FIRST, IN THIS ORDER:
1. docs/DECISIONS.md
2. docs/agents/03-warden-security.md        (Warden spec: rules §3, approvals §5, injection §6, lines §7, contracts §15, tests §16)
3. docs/agents/03-warden-BUILD-LANES.md     (YOUR plan: lanes X L J A G I, models, merge order, handoffs §6)
4. src/shared/events.ts, src/shared/tools.ts, src/main/runtime/types.ts on main, and
   src/main/testing/stubWarden.ts + src/main/runtime/jobs.ts on chip/logic (the stub you replace; pauseClock is boolean)
5. docs/agents/02-archie-files.md §2, §4, §13, §14   (sandbox, tools, what Warden enforces, AgentRuntime hook points)
6. docs/agents/01-chip-orchestrator.md §3, §4.1, §4.4, §9   (help jobs, job clock, speech priority, stop)
7. docs/GIT-WORKFLOW.md

WAVE 0:
- Open a small PR contracts/warden -> main with EXACTLY spec §15 (types.ts: WardenVerdict, GateRequest,
  WardenGate, ApprovalHow, ApprovalOutcome, ApprovalRequest, Approvals, ScreenSource, ScreenResult,
  InjectionScreen; tools.ts: ToolInspection + ToolDefinition.inspect?; events.ts: approval.resolve how?).
  Tell me the PR link; ask me to merge it before Archie's lane R starts. Shafeen does not wait on it.
- Create branch warden/logic FROM chip/logic, write lane files docs/lanes/WARDEN-<X>.md, and make a
  worktree per lane: git worktree add ../ade-wt-warden-logic-<x> -b lane/warden-logic-<x> warden/logic
- Dispatch X and L now. After the contracts PR merges: rebase warden/logic on main, then dispatch J, A, G.

DISPATCH: give me the EXACT launch command or instruction per lane, using the model, effort, and engine
in the plan's lane table (Codex via stdin with --ignore-user-config --disable apps; Claude interactive
in the worktree). I launch them. Never move a strong-floor lane to AGY; escalate effort before band.

AUDIT + MERGE: re-run every lane's tests yourself; no test may touch my real folders; diff = owned paths
only, no secrets; you (Opus) check X's rule matrix against spec §3 and review J, A, G, and I before
merging (security-critical). Merge into warden/logic: X -> L -> J -> A -> G. Then, once beaver/logic has
Archie's lane R (AgentRuntime), git merge origin/beaver/logic and run lane I. npm test after each; push.
Done = W-1..W-36 green AND every Chip test (C1-C19 + unit suites) AND every Archie test (A1-A20) green
with the REAL gate. When Shafeen posts "Warden sponsor kit ready", merge origin/warden/sponsors.

RULES: never commit .env; deny MCP tool calls; the gate must FAIL CLOSED; Approvals (not the runtime)
calls pauseClock/resumeClock; STOP and ask on spec conflicts. Report a status table (lane | state | next)
after every step.
```

## Shafeen — Warden sponsor tech
*Paste into: Claude Code, **Opus 5.5**, `/effort high`, repo root. Start after Chip's sponsor kit is handed off. Use only after the Warden plan is approved.*

```text
You are the ORCHESTRATOR for WARDEN's sponsor tech (ElevenLabs voice + pre-generated lines + SFX, Tiger
audit view + queries, Backboard injection classifier) in the ADE repo. Plan, write lane specs, dispatch,
audit, merge. Don't implement lanes yourself except few-line fixes.

READ FIRST:
1. docs/DECISIONS.md
2. docs/agents/03-warden-SPONSOR-LANES-SHAFEEN.md   (YOUR plan: lanes WW1 WT1 WB1 WV1 WV2)
3. docs/agents/03-warden-security.md sections 6.3 (classifier), 7 (lines), 8 (inspect card + Audit data), 10 (sponsors)
4. docs/SPONSORS.md (Warden rows) and docs/agents/01-chip-SPONSOR-LANES-SHAFEEN.md (tooling you reuse)

SETUP: no lane needs Warden's contracts PR. Branch warden/sponsors from main (merge origin/chip/sponsors
first if it isn't on main yet); lane files docs/lanes/WARDEN-SP-<X>.md; worktrees:
git worktree add ../ade-wt-warden-sponsors-<x> -b lane/warden-sponsors-<x> warden/sponsors

DISPATCH each lane with the exact model, effort, and engine from the lane table (Codex via stdin with
--ignore-user-config --disable apps; Claude/AGY interactive). I launch them. AGY only on WV1/WV2 (value
floor). For WV1, tell me when Warden's voice previews are ready so the team can pick one; his lines are
rendered ONCE (always [serious]) and shipped as mp3s.

AUDIT + MERGE into warden/sponsors: WW1 -> WT1 -> WB1 -> WV1 -> WV2; you review WT1 and WB1; no keys in
diffs; npm test after each (Chip's and Archie's sponsor tests must stay green); push. Run the smoke test
in plan section 2, tell me to post "Warden sponsor kit ready: <commit>", and open PR warden/sponsors -> main.

RULES: never edit src/shared or types.ts (Melvin owns them); Warden's Backboard calls always use
memory "off"; the classifier must fail safe (return null on any error); deny MCP tool calls; STOP and
ask if a real API differs from the docs. Status table after every step.
```

## Zarin — Warden graphics
*Paste into: **Codex**, repo root. Use only after the Warden plan is approved.*

```text
Help me build and save WARDEN THE WOLF's 3D model and animations for the ADE project.

1. Read docs/animations/Warden_Animations_for_Zarin.txt (my full list) and docs/ASSETS.md sections 2
   and 5 (export rules, character.json). Summarize the Tier 1 list for me in 10 lines. Note: Warden has
   Guard instead of Scared and Proud instead of Happy, and no Think/Sad/Nervous/Excited clips.
2. Git: git switch main && git pull && git switch -c warden/graphics && git push -u origin warden/graphics
3. Make sure tools/blender/required_clips.json has the "wolf" entry with EXACTLY the clip names
   from Warden_Animations_for_Zarin.txt (loop flags + tiers), and that
   src/renderer/public/characters/wolf/character.json has "clipMap": { "Scared": "Guard", "Happy": "Proud" }.
4. When I say "check", run:
     blender -b art/wolf/wolf.blend --python tools/blender/check_character.py -- wolf
   and explain any FAIL lines in plain words.
5. When I say "export", run:
     blender -b art/wolf/wolf.blend --python tools/blender/export_character.py -- wolf
6. When I say "save", commit and push only art/wolf, src/renderer/public/characters/wolf, and
   tools/blender with a message like "warden(graphics): Tier 1 clips ...".
Never touch other folders. Stop and tell me if any file is over 100 MB.
```

---

## Prompts for later agents
Each new agent plan (Pixel, Warden, Scout, Swarm, then the app shell) adds its own prompt sections here.
