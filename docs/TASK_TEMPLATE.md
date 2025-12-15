# Task template (for Codex)

## Task name
Short, specific title.

## Context
What user problem this solves. What page(s)/workflow(s) are impacted.

## Inputs
- Data sources (SDE / ESI / zKillboard / local JSON)
- Configs used (if any)
- Defaults (region/period/etc.)

## Logic (no code)
Step-by-step:
1) ...
2) ...

## Output
- Files changed/produced (e.g., `json/*.json`, `cache/*.json`)
- Frontend behavior changes (what UI shows)
- Schema changes (yes/no; if yes → update `docs/DATA.md`)

## Constraints
- Performance limits (time/memory)
- API rate limits / backoff rules
- Cache TTL expectations
- Backwards compatibility expectations

## Testing / verification
- Commands to run (e.g., `node workers/...`, `node server.js`)
- What to check in the UI (page URLs)

## Affected docs
- `docs/DATA.md`: yes/no
- `docs/DECISIONS.md`: yes/no

