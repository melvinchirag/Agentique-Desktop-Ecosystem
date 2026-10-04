# ADE Git Workflow — branches for every agent, every person

**Rule:** nobody works on `main`. Every person works on **their own branch for each agent**. Chanuth merges everything into `main` (the app) once the app shell exists.

---

## 1. Branch names

**Pattern:** `<agent>/<track>`

| Track | Who | Example (Chip) | Holds |
|---|---|---|---|
| `logic` | Melvin (or whoever builds that agent's brain) | `chip/logic` | The agent's code: orchestrator, tools, prompts, tests |
| `sponsors` | Shafeen | `chip/sponsors` | Backboard / ElevenLabs / Tiger pieces for that agent |
| `graphics` | Zarin | `chip/graphics` | `.blend` source, exported `.glb`, animation checks |

**Every agent gets the same three:**
- `pixel/logic`, `pixel/sponsors`, `pixel/graphics`
- `warden/…`, `archie/…`, `scout/…`, `swarm/…`, `iris/…`, `celene/…`

**Other branches:**

| Branch | What |
|---|---|
| `app/shell` | The Electron app + renderer (3D scene, Agent Hub, chat, screens). Owner TBD. |
| `biome/forest` | The forest biome graphics (Zarin) |
| `docs/plan` | Plan doc updates (Chanuth) |

**AI lane branches** (Hydra worktrees) hang off the person's branch:
`lane/<agent>-<track>-<lane>`, e.g. `lane/chip-logic-a`, `lane/chip-sponsors-s1`.
(Don't use `chip/logic/a`. Git can't have a branch `chip/logic` *and* `chip/logic/a`.)

---

## 2. Flow

```
main  ← only Chanuth merges here (contracts + docs first; the app once it exists)
  │
  ├── chip/logic      (Melvin)   ← lane/chip-logic-a, -c, -d, -e, -h, -g, -i merge here one at a time
  ├── chip/sponsors   (Shafeen)  ← lane/chip-sponsors-s1 … s6 merge here
  ├── chip/graphics   (Zarin)    ← commits per tier of animations
  ├── app/shell       (TBD)
  └── docs/plan       (Chanuth)
```

1. **Start a person branch** from the latest `main`:
   `git switch main && git pull && git switch -c chip/logic && git push -u origin chip/logic`
2. **AI lanes** (Melvin, Shafeen): one worktree per lane, branched from the person branch:
   `git worktree add ../ade-wt-chip-logic-a -b lane/chip-logic-a chip/logic`
   The orchestrator audits each lane and merges it **into the person branch** (not `main`), one at a time, then runs the tests on the person branch.
3. **Push the person branch often**: at least after every merged lane or every finished animation tier.
4. **Done with an agent track** → open a **Pull Request** into `main`, titled `chip/logic → main`. Chanuth reviews and merges.

---

## 3. Special rules

| Situation | Rule |
|---|---|
| **Shared contracts** (`src/shared/*`, `src/main/runtime/types.ts`) | Go to `main` **first**, through a quick PR that Chanuth approves (Melvin's Wave 0). Everyone then rebases onto `main`. Nobody edits them on their own branch. |
| **Melvin needs Shafeen's sponsor kit before the app exists** | Melvin merges `origin/chip/sponsors` into `chip/logic` locally (`git merge origin/chip/sponsors`) once Shafeen posts "sponsor kit ready". Owned paths don't overlap, so there are no conflicts. |
| **Merge conflicts** | Resolve in favor of the file's owner (paths listed in each plan). If unsure, ask Chanuth. |
| **Secrets** | Never commit `.env`, keys, or connection strings. `.gitignore` covers `.env*`, `voice-cache/`, `node_modules/`, `dist/`, `out/`. |
| **Big binary files** | `*.blend` (and `*.fbx`) go through **Git LFS** (setup in Zarin's plan). `.glb` ≤ 5 MB and `.mp3` sound effects stay in normal git. |
| **Commit messages** | `<agent>(<track>): what changed`, e.g. `chip(graphics): Tier 1 clips Idle Talk Scared Happy`, `chip(logic): JobScheduler with help jobs` |

---

## 4. Once the app shell exists (integration checkpoint)

1. Chanuth merges into `main`, in order: `app/shell` → `chip/sponsors` → `chip/logic` → `chip/graphics` (+ `biome/forest`).
2. Then Lane J2 hooks Chip into the app (Melvin's plan).
3. Later agents follow the same order: `<agent>/sponsors` → `<agent>/logic` → `<agent>/graphics`.
4. `npm test` + `npm run dev` on `main` after every merge.
