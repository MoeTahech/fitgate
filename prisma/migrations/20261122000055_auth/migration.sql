-- CreateTable
CREATE TABLE "trainer_invites" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "invited_by_id" TEXT NOT NULL,
    "status" "invite_status" NOT NULL DEFAULT 'PENDING',
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "accepted_at" TIMESTAMPTZ(3),
    "accepted_by_id" TEXT,
    "revoked_at" TIMESTAMPTZ(3),
    "revoked_by_id" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trainer_invites_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "trainer_invites_token_hash_key" ON "trainer_invites"("token_hash");

-- CreateIndex
CREATE INDEX "trainer_invites_email_idx" ON "trainer_invites"("email");

-- AddForeignKey
ALTER TABLE "trainer_invites" ADD CONSTRAINT "trainer_invites_invited_by_id_fkey" FOREIGN KEY ("invited_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trainer_invites" ADD CONSTRAINT "trainer_invites_accepted_by_id_fkey" FOREIGN KEY ("accepted_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trainer_invites" ADD CONSTRAINT "trainer_invites_revoked_by_id_fkey" FOREIGN KEY ("revoked_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─── Constraints not expressible in Prisma schema ───────────────────────────
-- Keep in sync with prisma/schema.prisma. Prisma does not diff CHECK
-- constraints, partial indexes, or triggers; changes go in a new migration.

-- Users: Better Auth lowercases emails on create, update, and lookup.
ALTER TABLE "users"
  ADD CONSTRAINT "users_email_lower_check" CHECK ("email" = lower("email"));

-- Last-admin backstop for writes outside the role service (which locks admin
-- rows and is the primary guard). Raises only when the statement removed an
-- active admin and none remain, so changes before the first admin exists pass.
CREATE FUNCTION "users_last_admin_guard"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM old_rows WHERE "role" = 'ADMIN' AND "anonymized_at" IS NULL)
     AND NOT EXISTS (SELECT 1 FROM "users" WHERE "role" = 'ADMIN' AND "anonymized_at" IS NULL)
  THEN
    RAISE EXCEPTION 'At least one active admin must remain'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'users_last_admin_guard', TABLE = 'users';
  END IF;
  RETURN NULL;
END;
$$;

CREATE TRIGGER "users_last_admin_guard_update"
  AFTER UPDATE ON "users"
  REFERENCING OLD TABLE AS old_rows
  FOR EACH STATEMENT EXECUTE FUNCTION "users_last_admin_guard"();

CREATE TRIGGER "users_last_admin_guard_delete"
  AFTER DELETE ON "users"
  REFERENCING OLD TABLE AS old_rows
  FOR EACH STATEMENT EXECUTE FUNCTION "users_last_admin_guard"();

-- Trainer invites
ALTER TABLE "trainer_invites"
  ADD CONSTRAINT "trainer_invites_email_check" CHECK ("email" = lower("email")),
  ADD CONSTRAINT "trainer_invites_expiry_check" CHECK ("expires_at" > "created_at"),
  ADD CONSTRAINT "trainer_invites_accepted_check" CHECK (
    ("status" = 'ACCEPTED') = ("accepted_at" IS NOT NULL AND "accepted_by_id" IS NOT NULL)
  ),
  ADD CONSTRAINT "trainer_invites_revoked_check" CHECK (
    ("status" = 'REVOKED') = ("revoked_at" IS NOT NULL AND "revoked_by_id" IS NOT NULL)
  );

CREATE UNIQUE INDEX "trainer_invites_one_pending_key" ON "trainer_invites" ("email") WHERE "status" = 'PENDING';