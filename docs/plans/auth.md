# Plan: Authentication milestone

Status: approved, not yet implemented. Branch: `feat/auth` (from `main`).
Scope: email/password sign-up and login, email verification, password reset,
secure session cookies, server-enforced roles (MEMBER, TRAINER, ADMIN),
trainer invites, role changes with the last-admin rule, audit logging, Redis
rate limiting, and development email.

Researched against Better Auth 1.7.27, Upstash docs, and the Next.js 16.4.6
docs bundled in `node_modules/next/dist/docs/`.

## Decisions

| # | Decision |
|---|---|
| 1 | Dependencies approved (pinned exactly): `better-auth`, `@better-auth/prisma-adapter`, `zod`, `@upstash/redis`, `@upstash/ratelimit`, `nodemailer`, `server-only`; dev: `@types/nodemailer`, `vitest`. The Better Auth CLI runs via `npx auth@1.7.27` and is not installed. |
| 2 | Development email: Mailpit container + nodemailer (SMTP). `EMAIL_TRANSPORT=console` as a fallback for machines without Docker. |
| 3 | Add Vitest now. Tests cover the last-admin rule, invite acceptance, role guards, and the rate limiter, against the Docker database. |
| 4 | If Redis is unavailable: allow the request, log an error, and fall back to an in-memory limiter per instance so limits still apply. |
| 5 | Branch `feat/auth` from `main` (database schema already merged). |
| 6 | No Better Auth admin plugin: its role changes can't run the last-admin check or write the audit row in our transaction. |
| 7 | Sessions stay in Postgres (no Better Auth secondary storage); cookie cache off so revocations and role changes apply immediately. |

## Constraints from the research

- Better Auth 1.7.27 peers: Next 14–16, Prisma 5–7. The Prisma adapter docs say
  Prisma 8 is not supported yet, which matches our 7.10.1 pin.
- The Prisma adapter ships as `@better-auth/prisma-adapter`; the CLI is the
  `auth` package (`npx auth@1.7.27 generate`).
- `verification.storeIdentifier: "hashed"` stores verification and reset
  identifiers hashed (spec: reset tokens stored hashed).
- With `requireEmailVerification`, sign-up returns the same 200 response whether
  or not the email exists; `onExistingUserSignUp` runs for existing emails.
- `rateLimit.customStorage` takes `consume(key, rule)` returning
  `{ allowed, retryAfter }`. Server-side `auth.api.*` calls are not rate limited.
- Better Auth's rate limiter is disabled in development by default; we enable it explicitly.
- Better Auth docs: don't await email sending (timing attacks); use the
  background task handler on serverless.
- Next 16: `middleware.ts` is now `src/proxy.ts` (Node.js runtime) and is for
  optimistic checks only. With `cacheComponents`, session reads must sit behind
  `<Suspense>`; the recommended current-user reader is a `'use cache: private'`
  function, whose result is browser-cached (~5 min stale), so it is not used for
  authorization.
- `after()` from `next/server` runs work after the response, using `waitUntil` on Vercel.
- Upstash recommends serverless-redis-http (SRH) to run `@upstash/redis` against a
  local Redis. Image `hiett/serverless-redis-http` has only a `latest` tag. Its
  support for the scripting commands `@upstash/ratelimit` uses is not documented
  and must be verified first (step 2).
- Unclear in the docs, to verify during implementation: whether Better Auth
  lowercases emails, whether secure cookies get the `__Secure-` prefix, and
  whether a sign-in attempt by an unverified user resends the verification email
  without `sendOnSignIn`.

## 1. Schema reconciliation

1. Run `npx auth@1.7.27 generate` against a minimal config, writing to a scratch
   file (never over `prisma/schema.prisma`), and diff it with our `User`,
   `Session`, `Account`, `Verification` models.
2. Expected: no structural change. Better Auth uses the Prisma client delegates
   (`db.user`, ...), so our `@@map`/`@map` snake_case plural tables are
   transparent. Our extras stay: user app fields,
   `@@unique([providerId, accountId])`, indexes.
3. `role` is declared to Better Auth as
   `user.additionalFields.role = { type: ["MEMBER", "TRAINER", "ADMIN"], input: false, defaultValue: "MEMBER" }`.
   The Postgres enum and DB default stay.
4. Better Auth keeps generating string IDs for its tables. The adapter runs with
   `transaction: true`.
5. New migration `auth` (via `--create-only` plus raw SQL):
   - `trainer_invites` table (section 5) with CHECKs and a partial unique index.
   - Trigger `users_last_admin_guard`: after an update of `role` or `anonymized_at`,
     or a delete on `users`, raise if no user with `role = 'ADMIN' AND anonymized_at IS NULL`
     remains. Backstop for manual SQL; the service's locking is the primary guard.
   - `users_email_lower_check` CHECK, only if Better Auth is confirmed to lowercase emails.
   - Any differences the CLI diff reveals.
6. The drift check must print an empty migration afterwards.

## 2. Better Auth configuration

Files: `src/lib/auth/server.ts` (auth instance), `src/lib/auth/client.ts`
(`createAuthClient`), `src/app/api/auth/[...all]/route.ts` (`toNextJsHandler(auth)`).

- `database: prismaAdapter(db, { provider: "postgresql", transaction: true })`.
- `emailAndPassword`: `enabled`, `requireEmailVerification: true`,
  `minPasswordLength: 10`, `maxPasswordLength: 128`, scrypt (default hash),
  `resetPasswordTokenExpiresIn: 3600`, `revokeSessionsOnPasswordReset: true`,
  `sendResetPassword` -> reset email.
- Existing email at sign-up: `onExistingUserSignUp` sends an "you already have
  an account" email with a reset link. The response is unchanged.
- `emailVerification`: `sendOnSignUp: true`, `sendOnSignIn: true`,
  `autoSignInAfterVerification: true`, `expiresIn: 3600`. The send callback
  enforces the per-email resend limit (section 6) and skips silently when exceeded.
- `verification.storeIdentifier: "hashed"`.
- `session`: `expiresIn` 7 days, `updateAge` 1 day, `freshAge` 1 day,
  `cookieCache` disabled.
- Cookies: `httpOnly`, `SameSite=Lax`, `Secure` in production
  (`advanced.useSecureCookies` in production), `advanced.cookiePrefix: "fitgate"`.
- `secret` from `BETTER_AUTH_SECRET`, `baseURL` from `BETTER_AUTH_URL`;
  CSRF/origin checks against `trustedOrigins` (defaults to `baseURL`).
- `advanced.backgroundTasks.handler` uses `after()`, so emails are sent after the
  response without being awaited in the request.
- `advanced.ipAddress.ipAddressHeaders: ["x-forwarded-for"]` (set by Vercel).
- Plugins: `nextCookies()`, last.
- Auth forms are client components calling `authClient` (HTTP through
  `/api/auth`). Server actions never call `auth.api` for these flows, so every
  attempt passes the rate limiter.

## 3. Server-side role enforcement

`src/lib/auth/session.ts`:
- `getCurrentUser()`: rendering only. `'use cache: private'`, returns a narrow
  `{ id, name, email, role }`, always called behind `<Suspense>`.
- `requireUser()` / `requireRole(...roles)`: uncached. Read the session from the
  database through Better Auth on every call; redirect (pages) or throw a typed
  error (server actions, route handlers). Called by every server action, route
  handler, and data-access function.
- Guards take an injectable session source so they can be tested without Next's request context.

Access rules:
- `/admin/*`: ADMIN.
- Trainer pages: TRAINER or ADMIN; trainers see only their own classes, rechecked at data access.
- Unverified users can't sign in (Better Auth), so guards only see verified users.

`src/proxy.ts`: cookie-presence redirect (`getSessionCookie`) for `/admin`,
`/trainer`, `/account` to `/sign-in?next=...` (relative paths only). Never an
authorization decision.

## 4. Role changes and the last-admin rule

`src/lib/services/roles.ts` `changeUserRole({ actorId, targetUserId, newRole, ipHash })`,
input validated with Zod, one transaction:

1. Lock the actor, the target, and every ADMIN row, in id order:
   `SELECT id, role, anonymized_at FROM users WHERE role = 'ADMIN' OR id IN ($actor, $target) ORDER BY id FOR UPDATE`.
   Concurrent demotions serialize on the admin rows.
2. Actor must still be ADMIN; target must not be anonymized.
3. Same role: no-op, no audit row.
4. Last-admin rule: if the target is ADMIN, the new role isn't ADMIN, and the
   active admin count is 1, reject with `LAST_ADMIN`. Applies to self-demotion too.
5. Demoting a TRAINER (to MEMBER) is rejected while they have upcoming
   `SCHEDULED` sessions or active class templates; they must be reassigned first.
6. Update the role. On a demotion, delete the target's sessions.
7. Audit row `user.role_changed` with `details: { from, to }`, actor, `ipHash`.

UI: `/admin/users` (searchable list, role selector, server action calling the service).

First admin: `npm run auth:create-admin` (`scripts/create-admin.ts`). Only runs
while no admin exists. Creates the user through Better Auth's server API, marks
the email verified, sets ADMIN, and writes `user.role_changed` with
`details: { from: "MEMBER", to: "ADMIN", via: "bootstrap" }` and no actor.

## 5. Trainer invites

Model `TrainerInvite` (`trainer_invites`):
- `id` (uuid v7), `email` (lowercase), `tokenHash @unique`,
  `invitedById -> User`, `status InviteStatus @default(PENDING)`, `expiresAt`,
  `acceptedAt?`, `acceptedById -> User?`, `revokedAt?`, `revokedById -> User?`, `createdAt`.
- Index `(email)`; partial unique `(email) WHERE status = 'PENDING'`.
- CHECKs: email is lowercase; `(status = 'ACCEPTED') = (accepted_at IS NOT NULL AND accepted_by_id IS NOT NULL)`;
  `(status = 'REVOKED') = (revoked_at IS NOT NULL AND revoked_by_id IS NOT NULL)`.

Token: 32 random bytes, base64url, in the link only; SHA-256 hash stored. Valid
7 days, single use.

Flow:
1. Create (admin): reject if the email belongs to a TRAINER or ADMIN. In one
   transaction revoke older pending invites for the email, insert the invite,
   write `trainer_invite.created`; send the email after commit.
2. Accept: `/invite/trainer/[token]`. The person signs up or signs in (new
   accounts verify their email as usual) and returns to the page via
   `callbackURL`. Acceptance, one transaction: lock the user row, then the
   invite (`FOR UPDATE`); require PENDING, not expired, and the signed-in user's
   verified email equal to the invite email; set role TRAINER (an ADMIN keeps
   ADMIN); mark ACCEPTED; write `user.role_changed`
   (`details: { from, to, via: "trainer_invite", inviteId }`) and `trainer_invite.accepted`.
3. Revoke and resend (admin): resend = revoke + new invite. Both audit-logged.
   Expired invites are marked EXPIRED when next read.

UI: `/admin/trainers` (invite form, pending invites with revoke/resend).

## 6. Rate limiting

One helper: `src/lib/rate-limit.ts`.

- Client: `@upstash/redis` + `@upstash/ratelimit` (sliding window), one
  `Ratelimit` instance per policy, `ephemeralCache` enabled, `timeout: 1000` ms.
- Production: Upstash Redis. Local: `redis` + `srh` in compose. Same code; only
  `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` differ.
- API:
  - `rateLimit(policy, identifier)` returns `{ success, remaining, resetAt }`.
  - `betterAuthRateLimitStorage`: `consume(key, rule)` for Better Auth's
    `rateLimit.customStorage`, backed by the same client.
- Keys: `rl:{policy}:{hmac(identifier)}`. No raw emails or IPs in Redis.
- Redis unavailable (error, or a result with timeout `reason`): log an error,
  then apply an in-memory sliding-window limiter per instance with the same
  policy limits. Memory is bounded (expired entries pruned; capped key count).
- Integration:
  - Per-IP limits: Better Auth's limiter, `enabled: true` in every environment,
    `storage` via `customStorage`, `customRules` per path.
  - Per-email limits: a Better Auth `hooks.before` middleware on the relevant
    paths calls `rateLimit()` and throws a 429 `APIError` with `Retry-After`.
  - Trial start: no flow exists yet (billing milestone). The policy is defined
    here; the trial server action calls `rateLimit("trialStart", ...)` when built.
- Limited requests return the same generic message as other failures (no
  account-existence leaks).

| Policy | Path | Limit |
|---|---|---|
| `signIn` | `/sign-in/email` | 5 / 15 min per IP + email; 20 / 15 min per IP |
| `signUp` | `/sign-up/email` | 5 / hour per IP |
| `passwordResetRequest` | `/request-password-reset` | 3 / hour per email; 10 / hour per IP |
| `passwordReset` | `/reset-password` | 10 / 15 min per IP |
| `verificationEmail` | verification send | 3 / hour per email |
| `trialStart` | trial server action | 3 / day per user; 10 / day per IP |

## 7. Email

`src/lib/email/`:
- `sendEmail({ to, subject, text, html })` with transports selected by
  `EMAIL_TRANSPORT`: `smtp` (nodemailer; Mailpit locally) or `console`.
- Templates as plain TypeScript functions returning `{ subject, text, html }`:
  verification, password reset, already-registered, trainer invite.
- Production provider chosen later behind the same interface.
- Email addresses and links are never written to logs or audit details.

## 8. Configuration

`compose.yaml` additions (all bound to `127.0.0.1`):
- `redis`: `redis:7.4-alpine`.
- `srh`: `hiett/serverless-redis-http` pinned by image digest; `SRH_MODE=env`,
  `SRH_TOKEN` from `.env`, `SRH_CONNECTION_STRING=redis://redis:6379`; host port 8079.
- `mailpit`: `axllent/mailpit` pinned version; SMTP 1025, web UI 8025.

`.env.example` additions: `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`,
`UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`, `SRH_TOKEN`,
`EMAIL_TRANSPORT`, `SMTP_HOST`, `SMTP_PORT`, `EMAIL_FROM`, `HASH_SECRET`,
`TEST_DATABASE_URL`. `HASH_SECRET` replaces the unused `TRIAL_HASH_SECRET`, with
a separate prefix per purpose (trial hashes, rate-limit keys, IP hashes).

`src/lib/env.ts`: Zod schema for all server env vars, validated at startup.

## 9. Tests (Vitest)

- `vitest.config.ts` with the `@` alias configured directly (no extra plugin).
  Scripts: `npm test` (`vitest run`), `npm run test:watch`.
- Database: a separate `fitgate_test` database in the Docker Postgres. Global
  setup creates it if missing and runs `prisma migrate deploy` against
  `TEST_DATABASE_URL`. Setup refuses to run unless the database name ends in
  `_test`. Tables are truncated between test files.
- Redis: tests run through SRH with a unique key prefix per run; the fallback
  test points the client at an unreachable URL.
- Coverage:
  - Last-admin rule: demoting the last admin fails; two concurrent demotions of
    the only two admins leave exactly one admin; the trigger blocks direct SQL.
  - Role changes: non-admin actor rejected, anonymized target rejected, trainer
    with upcoming sessions rejected, sessions revoked on demotion, audit row written.
  - Invite acceptance: success path; expired, revoked, already accepted, and
    email-mismatch rejected; concurrent double accept succeeds once.
  - Role guards: `requireUser`/`requireRole` with stubbed sessions per role.
  - Rate limiter: allows up to the limit then blocks; window reset; falls back to
    the in-memory limiter when Redis is unreachable and still enforces limits.

## Implementation steps (one small commit each)

1. Install the approved dependencies.
2. Compose services (`redis`, `srh`, `mailpit`) and `.env.example`. Verify
   `@upstash/ratelimit` works through SRH; if it doesn't, stop and decide before
   choosing another approach.
3. Vitest setup and test database bootstrap.
4. Schema diff with the Better Auth CLI; `auth` migration (`trainer_invites`,
   last-admin trigger, email CHECK if confirmed).
5. `src/lib/env.ts`, crypto helpers (tokens, SHA-256, HMAC), email module.
6. `src/lib/rate-limit.ts` with fallback, Better Auth storage adapter, tests.
7. Better Auth server and client config, route handler, session guards, `src/proxy.ts`, guard tests.
8. Auth pages: sign-up, sign-in, verify-email notice and resend, forgot
   password, reset password, sign-out.
9. Role-change service, `/admin/users`, tests.
10. Trainer invite service, admin page, accept page, tests.
11. `auth:create-admin` script.
12. Update `docs/spec.md` and `CLAUDE.md` (stack, commands, env vars, auth conventions).

## Verification

- End to end with Mailpit: sign-up, verification, login, password reset (other
  sessions revoked), existing-email sign-up email, trainer invite and acceptance.
- Repeated attempts return 429 with `Retry-After`; Redis keys contain no raw
  emails or IPs; stopping the `redis` container keeps limits working via the fallback.
- The `verifications` table holds hashed identifiers.
- Demoting the last admin fails via the UI, the service, and direct SQL.
- Audit rows for role changes and invites.
- `npm test`, `npm run lint`, `npx tsc --noEmit`, `npm run build`, and the empty drift diff.
