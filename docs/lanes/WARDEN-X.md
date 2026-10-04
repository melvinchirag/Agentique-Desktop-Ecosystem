# WARDEN-X: fixtures (injection corpus, benign set, rule matrix)

**Branch:** `lane/warden-logic-x`. **Read first:** `docs/lanes/WARDEN-COMMON.md`.

## Owned paths (only these)
- `tests/fixtures/warden/**`

## Build
Per BUILD-LANES section 3 lane X and spec sections 3, 6.2 and 16:
- `injection/`: malicious samples (forward-all email, malicious notes.txt, zero-width hidden text, `</untrusted>` breakout, base64 blob over 200 chars, hidden-HTML email, exfil image link, instruction-giving calendar title, instruction-giving specialist summary). One file per sample plus an `index.json` listing each with its source kind and a one-line `why`.
- `benign/`: innocent texts that merely contain words like "ignore", "forward", "password", "previous instructions" in normal use. Same layout.
- `rule-matrix.json`: about 70 rows `{ id, agentId, tool, risk, args, inspect, jobKind, tainted, priorDenied, priorDeclined, expect: { verdict, rule } }`, at least 3 rows per rule W0 to W16. Include the edge cases from BUILD-LANES: W5 `Downloads2` prefix trick, `.git` path, move into ADE Trash; W6 exactly 25 vs 26 files; W11 37-file undo vs tainted undo; W12 `javascript:` and `.exe` URL; W14 help + destructive; W10 `ask_teammate` in a help job; W1 `fs_propose_plan` must NOT match.
- `tests/fixtures/warden/README.md` describing the format.

## Done when
The JSON parses, every rule W0 to W16 has at least 3 rows, every injection sample has a `why`. **The orchestrator checks every expected verdict against spec section 3** (this matrix is lane G's test oracle), so when a row is ambiguous, say so in your report instead of guessing.
