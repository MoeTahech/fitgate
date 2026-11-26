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
- Windows PowerShell 5.1 reads UTF-8 files without a BOM as ANSI, so
  `Get-Content`/`Set-Content` round-trips corrupt non-ASCII text (e.g. `…`).
  Edit files with editor tools, not PowerShell read/write.

## Stack
- Next.js (App Router, `src/` dir) + TypeScript strict + Tailwind v4
- PostgreSQL 17 (local: Docker on host port 5433; prod: Neon, must be PG 17)
- Prisma 7.10.1 pinned (npm `latest` tag points to an 8.x RC; do not upgrade
  without asking). Driver adapter `@prisma/adapter-pg`.
- Better Auth 1.7.27 (email/password, `@better-auth/prisma-adapter`; no admin
  plugin). Roles MEMBER, TRAINER, ADMIN in `users.role`. CLI only via
  `npx auth@1.7.27`, not installed.
- Zod 4 for validation. Vitest 5 for tests.
- Redis via `@upstash/redis` (prod: Upstash; local: `redis` + `srh` REST proxy
  in compose). Rate limiter is our own Lua script, not `@upstash/ratelimit`
  (its scripts use an Upstash-only flag that local Redis rejects).
- Email via nodemailer: Mailpit locally (`EMAIL_TRANSPORT=smtp`) or `console`;
  production provider not chosen yet.
- UI: shadcn/ui (`base-nova` style, `components.json`) on Base UI (`@base-ui/react`),
  `class-variance-authority`, `lucide-react` icons, `tw-animate-css`. Class merging via
  `cn` from `@/lib/utils` (re-exports the `cn` package; never import `cn` directly). The
  shadcn CLI only via `npx shadcn@4.23.0`, not installed; the state variants its
  `tailwind.css` would add are copied into `globals.css`.
- Planned, not installed yet: Stripe (test mode only).

## Commands
- `npm run dev` / `npm run build` / `npm run start`
- `npm run lint` (ESLint 9 flat config in `eslint.config.mjs`)
- `npx shadcn@4.23.0 add <item>` add a UI primitive to `src/components/ui/`; then switch
  its `cn` import to `@/lib/utils` and adjust it to our tokens.
- `npx tsc --noEmit` type check. Route types (`PageProps`, `LayoutProps`) are
  generated: after adding or renaming routes run `npx next typegen` first.
- `docker compose up -d` start local services (Postgres, Redis + SRH REST proxy
  on 8079, Mailpit SMTP 1025 / UI http://localhost:8025); `docker compose ps` status
- `npm run db:migrate` (`prisma migrate dev`), `npm run db:deploy` (prod migrations)
- `npm run db:seed` seed plans, gym settings, opening hours (create-only, safe to re-run)
- `npm run db:studio`; `npx prisma generate` (also runs on `postinstall`; Prisma 7
  `migrate dev` does not run it, so run it after schema changes)
- `/verify` (project skill in `.claude/skills/verify/`): tsc, lint, tests in order;
  stops at the first failure.
- `/migration` (project skill in `.claude/skills/migration/`): the full schema
  change workflow (create-only, raw SQL, drift check, generate, constraint tests).
- `npm test` (`vitest run`) / `npm run test:watch`. Needs Docker running and
  `TEST_DATABASE_URL` (database name must end in `_test`).
- `npm run auth:create-admin` create the first admin (only while none exists);
  prompts, or reads `ADMIN_NAME`/`ADMIN_EMAIL`/`ADMIN_PASSWORD`. Scripts that
  import server code run with `tsx --conditions=react-server --env-file-if-exists=.env`.

## Testing
- Vitest, config in `vitest.config.mts`. Tests are colocated as `src/**/*.test.ts(x)`;
  shared setup and helpers live in `tests/`.
- Component tests (`.test.tsx`, Node environment, no DOM) render with `renderMarkup` from
  `tests/support/markup.ts` (`renderToStaticMarkup` + a small parser) and assert structure and
  attributes with `find`/`findAll`/`byTag`/`byAttr`/`textOf`/`classesOf`. Behaviour that needs
  a browser (focus, events) is checked by hand.
- Global setup runs `prisma migrate deploy` against `TEST_DATABASE_URL` (creating
  the database if missing); workers get it as `DATABASE_URL`. Test files run
  sequentially and all tables are truncated before each file.
- `server-only` is aliased to its empty module so server code can be imported.
- Integration tests hit real local services: Redis through SRH (use a unique key
  prefix) and Mailpit (`tests/support/mailpit.ts`). Requests to Better Auth go
  through the route handler with a random `x-forwarded-for` so per-IP limits
  don't collide across runs. Factories in `tests/support/factories.ts` (plan presets,
  `createOwnedMembership`); `expectMembershipError` in `tests/support/membership-errors.ts`.
- Time-dependent tests fake only `Date`: `vi.useFakeTimers({ toFake: ["Date"] })` +
  `vi.setSystemTime(...)`, restored with `vi.useRealTimers()` in `afterEach`.
- Code that calls `requireUser`/`requireRole` is tested by mocking `@/lib/auth/session` with the
  real guards over a hoisted user: `vi.mock("@/lib/auth/session", async () => (await
  import("@/lib/auth/guards")).createGuards(async () => session.user))`, with `session` from
  `vi.hoisted` and reset in `afterEach` (see `memberships/queries.test.ts`).

## Architecture
- `next.config.ts` enables `cacheComponents` and `partialPrefetching`; consult
  the bundled docs before writing data fetching or caching code.
- Tailwind v4 runs through a Turbopack rule; imported via `@import "tailwindcss"`
  in `src/app/globals.css`.
- Path alias: `@/*` -> `src/*`.
- Business logic goes in `src/lib/services/`; route handlers stay thin.
- Audit rows: `audit(tx, entry)` from `src/lib/services/audit.ts`, always with the
  transaction of the change.
- Memberships: `src/lib/services/memberships/`. `rules.ts` pure rules (usability, overdue,
  periods, `freezeDisplayStatus`, `remainingUsableDays`, and `openBaseReplacement`: decision 13's
  supersede/switch/conflict outcome, shared by `resolveOpenBase` and the record-payment read
  model); `internal.ts` shared transaction helpers for the membership services only
  (`lockUsers`/`lockMembership`, `requireActiveAdmin`, `authorizeOwnerOrAdmin`, `getGymClock`,
  overdue cleanup and `endIfOverdue`, `endMembership`, `resolveOpenBase`, `consumeRateLimit`); `errors.ts` `MembershipError(code, details?)` and
  `toMembershipError`, which maps backstop unique-index violations to domain codes;
  `schemas.ts` shared Zod schemas (`noteSchema`/`reasonSchema`: trimmed, max 500, no email
  or URL; `referenceSchema`, `manualPaymentMethodSchema`); `manual.ts` manual create/extend;
  `corrections.ts` void and manual refund of manual payments (`correctionOptions` reports which
  corrections a payment accepts); `freezes.ts` request, approve,
  reject, cancel (approval shifts the period end and valid payment periods; cancel undoes it);
  `trials.ts` `startTrial` (rate limited per user and IP before its transaction) and the
  read-only `trialEligibility`, which share one check and report the same codes; `invites.ts`
  couples invites (create/resend share the `membershipInvite` limit; send the email with
  `sendMembershipInvite` after commit), accept, remove partner, leave, and the public
  `findMembershipInviteByToken` for `/invite/membership/[token]`. Accept failures that record a
  change (invite found expired, overdue membership ended) commit it, then throw.
  `queries.ts` read models for pages: member (`getMyMemberships`, `getMyTrialEligibility`,
  `listJoinablePlans`) and admin (`listMembers`, `getMemberDetail`, `listMemberships`,
  `listPendingFreezes`, `getMembershipDetail`, `listPayments`). Each calls `requireUser`/
  `requireRole("ADMIN")` first, works out display status from stored dates via the rules (SQL
  status filters mirror `effectiveStatus`), never writes, and returns the gym `timeZone`.
- Database: schema in `prisma/schema.prisma`, config in `prisma.config.ts`
  (loads `.env` itself; migrations use `DIRECT_URL`, falling back to `DATABASE_URL`).
  Import the client only via `db` from `src/lib/db.ts`. Generated client lives in
  `src/generated/prisma` (git-ignored). Seed: `prisma/seed.ts`.
- Tables/columns are snake_case (`@@map`/`@map`), table names plural. App IDs are
  UUIDv7 generated by Prisma (no DB default); Better Auth tables use string IDs.
  All timestamps are `timestamptz`.
- Env: read server config only via `env` from `src/lib/env.ts` (Zod-validated;
  `src/instrumentation.ts` validates at startup). Add new vars there and to `.env.example`.
- Auth (`src/lib/auth/`): `server.ts` is the Better Auth instance, `client.ts`
  the browser client (forms call it over HTTP so every attempt is rate limited),
  `session.ts` the guards, `schemas.ts` shared Zod schemas.
  `src/app/api/auth/[...all]/route.ts` mounts it.
- `src/proxy.ts` only redirects signed-out visitors (cookie presence) on
  `/admin`, `/trainer`, `/account`. It is never an authorization decision.
- Rate limiting: `rateLimit(policy, identifier)` from `src/lib/rate-limit`;
  policies in its `index.ts`. Redis failures fall back to a per-instance memory limiter.
- Email: `sendEmail` + templates from `src/lib/email`.
- Crypto: `generateToken`, `sha256`, `keyedHash(purpose, value)` from `src/lib/crypto.ts`.
- Time zones: all zone math and local-time display go through `src/lib/time.ts`
  (`zonedParts`, `zonedToInstant`, `addDaysZoned`, `addMonthsZoned`, `startOfZonedDay`,
  `localMinutes`, `localElapsedMs`, `formatLocal`, `formatLocalTime`). New code does no ad-hoc offset
  arithmetic and builds no own `Intl.DateTimeFormat`. DST gaps resolve forward, overlaps
  to the earlier instant.
- UI: design tokens in `src/app/globals.css` (`:root` light, shipped; `.dark` defined, applied
  only under a `.dark` class that nothing sets yet). Brand orange is only `primary`, `link`,
  `ring`, `header-active`; statuses use the `status-*` tokens, feedback `success`/`warning`/
  `info`/`destructive` (+ `-subtle`). `tests/ui/theme-contrast.test.ts` checks every token pair
  for WCAG AA; add new pairs there. `src/components/ui/` holds the shadcn primitives (edit
  freely). `src/components/` holds the app components pages use: `PageContainer`,
  `PageHeader`/`SectionHeader`, `CenteredPage`/`CenteredCard` (auth and invite pages; pass
  `focusTitle` on a success view that replaces a form so focus moves to its heading),
  `FormField`/`InputField`/`SelectField`, `SubmitButton`, `FormAlert` (form-level messages),
  `InlineStatus` (result line next to a row action; both are always-mounted live regions built
  on `LiveRegions`: in client components render them unconditionally and pass the message or
  nothing, and keep them at the same tree position when a success view replaces a form), `TextLink`, `Pagination`, `EmptyState`, `StatusBadge` (+ `MembershipStatusBadge`, `InviteStatusBadge`; each status enum
  gets a typed tone/label map there), `ConfirmDialog` (destructive or irreversible actions; posts its own hidden form to `action`, or
  submits an existing form via `form` (id); pass `finalFocus` when the action can remove its own
  trigger, and show row-action results above the list, not in the row),
  `DataTable` (record lists: column config; a table when its container is at least `@2xl`
  wide, a stack of cards below; a `grow` column truncates in table mode with `title`, wraps in
  card mode); plus primitives `Button`/`buttonVariants` (links styled as buttons), `Card`,
  `Skeleton` (Suspense fallbacks).
- Layout (`src/components/layout/`): `nav.ts` holds the nav config (`MAIN_NAV` with role
  filters, `ADMIN_NAV`; add new sections there) and link styles. `SiteHeader` (near-black bar,
  user part behind `<Suspense>` via `getCurrentUser()`), `MobileNav` (Sheet below `md`, includes
  admin sections for admins), `AdminNav` (sidebar from `md`, used by `src/app/admin/layout.tsx`;
  admin pages render their own `<main>`). `NavLinks` reads `usePathname`, which suspends under
  dynamic params: always wrap it in `<Suspense fallback={<NavLinksFallback …/>}>`.

## Conventions
- Pages and feature components build only from the shared components and tokens: no raw
  Tailwind palette classes (`zinc-`, `red-`, …), no `dark:` utilities, no one-off styling of
  buttons, inputs, cards, badges, alerts or tables. Layout utilities (flex, grid, gap, margin,
  width, responsive visibility) are fine. If a pattern is missing, add it to `src/components/`
  first. Displayed dates go through `formatLocal`/`formatLocalTime`. Record lists use
  `DataTable`, never the `Table` primitive directly in pages.
  `tests/ui/no-raw-styles.test.ts` fails on palette colors, black/white, arbitrary colors,
  `dark:` or a `ui/table` import in `src/app` and `src/components` (`src/components/ui/` excluded).
- Validate all external input with Zod. Client forms show Zod field errors with
  `showFieldErrors(form, errors, setErrors)` from `src/lib/forms/field-errors.ts` (flushes the
  errors, then focuses the first invalid field so its error is read out).
- Authorization is enforced on the server, never only in the UI.
- Store times in UTC; convert to the gym's time zone (`GymSettings.timeZone`) only for
  display and for local-calendar math (periods, opening hours), via `src/lib/time.ts`.
- Money as integer cents.
- Booking, waitlist, and credit changes run inside a DB transaction.
- Explicit time in membership (and later booking) services: take one `now` per call and pass
  it down; every timestamp written comes from it, including `createdAt` on inserted rows and
  audit rows. No SQL `now()`/`CURRENT_TIMESTAMP` or column defaults in time-dependent logic,
  queries, or constraints: tests fake only the JS `Date`.
- Row locks via `tx.$queryRaw ... FOR UPDATE`; lock order is always
  User -> Membership -> ClassSession to avoid deadlocks.
- Audit log rows are written in the same transaction as the change. Details
  never contain emails, links, tokens, or other personal data; IPs only as
  `keyedHash("ip", ...)` (`getRequestIpHash()`).
- Authorization: every server action, route handler, and data-access function
  that requires a signed-in user calls `requireUser()`/`requireRole(...)`
  (uncached, reads the DB session). `getSessionUser()` (the same uncached read,
  returning null when signed out) is allowed only where a signed-out visitor gets
  a normal response, e.g. the invite accept pages and actions showing "sign in to
  accept". Pages use `requirePageUser(returnTo, ...roles)` (sign-in redirect, 404
  on a missing role). `getCurrentUser()` is browser-cached and for display only.
  Services that change privileges also verify the actor inside their transaction.
- After the current user's auth state changes on the client (sign-in, sign-out,
  own role change), leave with `hardNavigate()` from `src/lib/auth/navigation.ts`,
  not `router.push/replace/refresh`: client navigations keep the root layout and
  the browser-cached `getCurrentUser()` result, so the old user would still show.
- Session reads and other request data sit behind `<Suspense>` (`cacheComponents`).
  With `partialPrefetching`, prefetch prerenders can read `headers()`/`cookies()`/
  `params`, so those are no suspension point: call `await io()` (from `next/cache`)
  before rendering code that reads the current time or randomness, directly or
  inside a library (e.g. Better Auth session validation, `new Date()` in queries).
- Tokens (invites, etc.): `generateToken()` in the link only, `sha256` stored.
- Rate limit new sensitive endpoints; limited responses must not reveal whether
  an account exists.
- The last active admin can't be demoted, anonymized, or deleted
  (`changeUserRole` locks admin rows; trigger `users_last_admin_guard` is the backstop).
- Stripe webhooks: verify signature, handle idempotently.

## Rules
- Ask before adding a dependency.
- Never edit an applied migration; create a new one.
- Prisma can't express CHECK constraints or partial unique indexes. Create the
  migration with `npx prisma migrate dev --create-only`, append the raw SQL, then
  apply. Afterwards `npx prisma migrate diff --from-config-datasource --to-schema
  prisma/schema.prisma --script` must print an empty migration.
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