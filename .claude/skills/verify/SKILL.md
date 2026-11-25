---
name: verify
description: Run the FitGate verification gate (type check, lint, tests) before saying a task is done or committing. Stops at the first failure.
---

# Verify

1. Make sure local services are up: `docker compose up -d`.
2. Run these in order, one at a time, stopping at the first failure:
   1. `npx tsc --noEmit` (after adding or renaming routes, run `npx next typegen` first)
   2. `npm run lint`
   3. `npm test`

On failure: stop, show the failing output (the relevant errors, not the whole log), and do not commit.

On success: report one line per step, e.g. `tsc ✓ · lint ✓ · tests ✓ (N passed)`.
