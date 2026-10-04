# Archie managed-agent dispatch — October 4

Melvin explicitly requested that Codex launch an agent for each task. This supersedes the earlier instruction that Melvin personally launches implementers. Managed implementation agents have disjoint worktrees and may not use MCP, edit shared contracts, commit, push, merge, or touch other worktrees. The parent orchestrator audits and integrates their work.

| Task | Agent | Model / effort | Scope |
|---|---|---|---|
| R | Erdos | Codex GPT-6 Sol / high | AgentRuntime and parser in beaver-r; owned R paths only |
| P | Faraday | Codex GPT-6 Sol / medium | safePath and index in beaver-p; owned P paths only |
| F | Hegel | Codex GPT-6 Luna / high | Fixture and primary journal in beaver-f; plan backup because AGY is unavailable |
| Sponsor retest | Beauvoir | Parent model inherited | Existing live sponsor smoke; new English report only; no credentials or source edits |
| Backboard review | Galileo | Parent model inherited | Read-only review of Chip/Backboard code and evidence; no duplicate API calls |

D was already audited and pushed at `6ca882f`. Its Claude replacement is recorded in ARCHIE-D.md: Claude exhausted its quota and resets at 7:00 AM. The same approved substitution applies to I after its dependencies are merged.

Merge order remains F → P → D → R, then T → O, then I. T and O have not started because they need the merged P/R APIs. I has not started because runtime and tools are incomplete. Passing a lane test or sponsor test is not a completion claim for Archie; a final PR follows the full offline scenario audit and records any outstanding live prerequisite.

Approvals owns clock pauses per DECISIONS §15f. No real personal folders are permitted in Archie tests. Credentials remain in the ignored root .env and are not copied into lane worktrees.
