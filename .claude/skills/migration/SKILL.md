---
name: migration
description: Change the FitGate database schema. Covers editing prisma/schema.prisma, creating the migration with --create-only, appending raw SQL (CHECK constraints, partial unique indexes, triggers), applying it, the drift check, prisma generate, the test database, and constraint tests in tests/db/. Use for any change to tables, columns, enums, indexes, or constraints.
---

# Migration

Prisma can't express CHECK constraints, partial unique indexes, or triggers, and
it doesn't diff them. They live as raw SQL at the end of each migration (see
`prisma/migrations/20261120194318_init` and `20261122000055_auth`). Every schema
change goes through a new migration created with `--create-only`.

Rules:
- Never edit a migration that has been applied (to any database) or committed. If
  it needs fixing, create a new migration. Editing the just-created, unapplied
  `--create-only` migration is fine.
- Ask the user before any destructive command: `npx prisma migrate reset`,
  `docker compose down -v`, or anything else that drops data. If Prisma says a
  reset is needed (drift, a modified or missing migration), stop and explain why
  before doing anything.
- Edit `migration.sql` with editor tools, not PowerShell `Get-Content`/`Set-Content`
  (the section headers contain non-ASCII characters that PowerShell 5.1 corrupts).
- Prisma is pinned at 7.10.1. Don't upgrade it.
- Local services must be running: `docker compose up -d`.

## 1. Edit `prisma/schema.prisma`

Follow the existing conventions: snake_case tables and columns via `@@map`/`@map`,
plural table names, enums mapped to snake_case (`@@map("plan_type")`), app IDs
`@id @default(uuid(7)) @db.Uuid`, timestamps `@db.Timestamptz(3)`, money as integer cents.

## 2. Create the migration without applying it

```powershell
npx prisma migrate dev --create-only --name <name>
```

`<name>` is short snake_case, usually the feature (`init`, `auth`, `memberships`).
This writes `prisma/migrations/<timestamp>_<name>/migration.sql` and leaves the
database unchanged.

## 3. Append the raw SQL

Review Prisma's generated SQL, then add the raw part at the end of the file,
after a header that matches the existing migrations:

```sql
-- ─── Constraints not expressible in Prisma schema ───────────────────────────
-- Keep in sync with prisma/schema.prisma. Prisma does not diff CHECK
-- constraints, partial indexes, or triggers; changes go in a new migration.

-- <Section, e.g. Plans>
ALTER TABLE "plans"
  ADD CONSTRAINT "plans_price_check" CHECK ("price_cents" >= 0),
  ADD CONSTRAINT "plans_currency_check" CHECK ("currency" ~ '^[a-z]{3}$');

CREATE UNIQUE INDEX "plans_one_active_trial_key" ON "plans" ("is_trial") WHERE "is_trial" AND "active";
```

Conventions:
- Quote every identifier. Use the mapped (snake_case) table and column names.
- Names: `<table>_<rule>_check` for CHECKs, `<table>_<rule>_key` for partial unique
  indexes, `<table>_<rule>_idx` for plain partial indexes. Tests match on these names.
- Group statements under a `-- <Section>` comment, one `ALTER TABLE` per table.
- For state columns, tie fields to the status in both directions, e.g.
  `CHECK (("status" = 'CANCELLED') = ("cancelled_at" IS NOT NULL))`.
- Constraints compare columns only (e.g. `"expires_at" > "created_at"`). Don't use
  `now()`/`CURRENT_TIMESTAMP`: tests fake only the JS clock.
- Triggers: a function plus triggers, with a comment explaining why the trigger
  exists and when it fires (see `users_last_admin_guard` in the auth migration).
- To change an earlier raw constraint, `DROP CONSTRAINT` / `DROP INDEX` it in the
  new migration and create the replacement.
- If existing rows must change to satisfy a new constraint, put the backfill
  `UPDATE`s before the `ADD CONSTRAINT` statements.

## 4. Apply it to the dev database

```powershell
npm run db:migrate
```

(`prisma migrate dev`, which applies the pending migration.) If `prisma/seed.ts`
changed, run `npm run db:seed` too (it only creates rows, so re-running is safe).

## 5. Drift check

```powershell
npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script
```

It must print exactly:

```
-- This is an empty migration.
```

Any SQL here means `schema.prisma` and the migrations disagree. Fix
`schema.prisma`, or add a new migration if the applied one is wrong, then run the
check again. Don't reset the database to make it pass.

## 6. Regenerate the client

```powershell
npx prisma generate
```

Prisma 7 `migrate dev` doesn't do this. The client is generated into
`src/generated/prisma` (git-ignored).

## 7. Test database

There's no separate command. Vitest's global setup (`tests/global-setup.ts`)
runs `prisma migrate deploy` against `TEST_DATABASE_URL` (the database name must
end in `_test`, and the database is created if missing) before every run. Any
`npm test` or `npx vitest run <file>` applies the new migration there.

## 8. Constraint tests in `tests/db/`

Add or extend `tests/db/<feature>-constraints.test.ts` (model:
`tests/db/auth-constraints.test.ts`). For each new CHECK, partial index, or trigger:

- Reset per test: `beforeEach(async () => { await resetDatabase(); })` from
  `../support/database`.
- Build rows with factories from `../support/factories` (`createUser`,
  `createClassTemplate`, `createClassSession`, ...) or `db` from `@/lib/db`. Add a
  factory there when a model needs one more than once.
- CHECKs: assert the violating write fails with the constraint name, then that
  the valid boundary case passes:
  ```ts
  await expect(createUser({ email: "Alice@Example.test" })).rejects.toThrow(/users_email_lower_check/);
  await expect(createUser({ email: "alice@example.test" })).resolves.toBeDefined();
  ```
- Partial unique indexes: assert that a second row inside the predicate fails with
  `/Unique constraint failed/`, and that rows outside the predicate (other status,
  ended, other key) still insert.
- Triggers: write with raw SQL (`db.$executeRaw`) so the test exercises the
  database guard itself, not service code, and cover both blocked and allowed cases.

Run the file, then the full suite:

```powershell
npx vitest run tests/db/<feature>-constraints.test.ts
npm test
```

## 9. Finish

1. Run `/verify` (tsc, lint, tests).
2. Commit `schema.prisma`, the new migration folder, any seed changes, and the
   tests together on the feature branch (conventional message, e.g.
   `feat: add memberships migration`).

Production (Neon, PG 17) applies migrations with `npm run db:deploy`, which uses
`DIRECT_URL`.
