# FitGate

Gym management web app: memberships + billing, QR check-in with live occupancy,
class booking with waitlists. Goal: production-quality, deployed, portfolio piece.
Full spec: docs/spec.md (read it before planning a new feature).

## Next.js version warning
Per [AGENTS.md](AGENTS.md): this is Next.js 16.4.6 / React 19.3 with breaking
changes versus common training data. Before writing Next.js code, read the
relevant guide in `node_modules/next/dist/docs/` and heed deprecation notices.
Leave the AGENTS.md block in place (auto-written by `next dev`).

## Environment
- Windows + PowerShell. Use PowerShell syntax, not bash (no `rm -rf`, `export`).
- Package manager: npm.

## Stack
- Next.js (App Router, `src/` dir) + TypeScript strict + Tailwind v4
- Planned, not installed yet: PostgreSQL + Prisma, Better Auth (roles: member,
  trainer, admin), Stripe (test mode only). Add details here once set up.

## Commands
- `npm run dev` / `npm run build` / `npm run start`
- `npm run lint` (ESLint 9 flat config in `eslint.config.mjs`)
- `npx tsc --noEmit` type check
- No test framework configured yet.

## Architecture
- `next.config.ts` enables `cacheComponents` and `partialPrefetching`; consult
  the bundled docs before writing data fetching or caching code.
- Tailwind v4 runs through a Turbopack rule; imported via `@import "tailwindcss"`
  in `src/app/globals.css`.
- Path alias: `@/*` -> `src/*`.
- Business logic goes in `src/lib/services/`; route handlers stay thin.

## Conventions
- Validate all external input with Zod.
- Authorization is enforced on the server, never only in the UI.
- Store times in UTC; convert to the gym's time zone only for display.
- Money as integer cents.
- Booking, waitlist, and credit changes run inside a DB transaction.
- Stripe webhooks: verify signature, handle idempotently.

## Rules
- Ask before adding a dependency.
- Never edit an applied migration; create a new one.
- Never read, print, or commit `.env`; keep `.env.example` updated.
- Changes to booking, billing, or access logic need tests.

## Git
- Never work on `main`; one branch per feature (`feat/...`, `fix/...`).
- Conventional commit messages (`feat:`, `fix:`, `chore:`), small commits.
- Never push, force-push, or delete branches without asking me.

## Workflow
- Non-trivial work: plan first, wait for my approval, then implement in small steps.
- Before saying a task is done: run lint and type check (and tests once they exist).
- After each task, give a short, clear summary: what changed, which files,
  and anything I need to do or decide. No tutorials or long explanations
  unless I ask.
- Always implement the production-grade approach. No tutorial-style comments in code.
- When the setup changes (new tool installed, new command, new folder
  convention), update CLAUDE.md in the same branch and mention it in your summary.