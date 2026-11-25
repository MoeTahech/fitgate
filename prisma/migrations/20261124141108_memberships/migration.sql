-- CreateEnum
CREATE TYPE "trial_kind" AS ENUM ('GYM', 'CLASS');

-- CreateEnum
CREATE TYPE "duration_mode" AS ENUM ('ROLLING', 'CALENDAR_DAYS');

-- DropIndex
DROP INDEX "trial_redemptions_email_hash_key";

-- DropIndex
DROP INDEX "trial_redemptions_phone_hash_key";

-- DropIndex
DROP INDEX "trial_redemptions_user_id_key";

-- AlterTable
ALTER TABLE "membership_invites" ADD COLUMN     "revoked_at" TIMESTAMPTZ(3),
ADD COLUMN     "revoked_by_id" TEXT;

-- AlterTable ("is_trial" is dropped below, after the backfill reads it)
ALTER TABLE "plans" ADD COLUMN     "duration_mode" "duration_mode",
ADD COLUMN     "trial_kind" "trial_kind";

-- AlterTable
ALTER TABLE "trial_redemptions" ADD COLUMN     "kind" "trial_kind" NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "trial_redemptions_user_id_kind_key" ON "trial_redemptions"("user_id", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "trial_redemptions_email_hash_kind_key" ON "trial_redemptions"("email_hash", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "trial_redemptions_phone_hash_kind_key" ON "trial_redemptions"("phone_hash", "kind");

-- AddForeignKey
ALTER TABLE "membership_invites" ADD CONSTRAINT "membership_invites_revoked_by_id_fkey" FOREIGN KEY ("revoked_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─── Constraints not expressible in Prisma schema ───────────────────────────
-- Keep in sync with prisma/schema.prisma. Prisma does not diff CHECK
-- constraints, partial indexes, or triggers; changes go in a new migration.

-- Plans: backfill before the new CHECKs.
-- Day Pass ends at closing time of its start day; other one-time plans roll.
UPDATE "plans"
SET "duration_mode" = CASE WHEN "slug" = 'day-pass' THEN 'CALENDAR_DAYS'::"duration_mode" ELSE 'ROLLING'::"duration_mode" END
WHERE "billing" = 'ONE_TIME';

-- The single Free Trial becomes the Gym Trial in place. No membership can
-- reference it yet: no trial flow existed before this migration.
UPDATE "plans"
SET "trial_kind" = 'GYM',
    "duration_mode" = 'CALENDAR_DAYS',
    "class_access" = 'NONE',
    "credits" = NULL,
    "name" = CASE WHEN "slug" = 'free-trial' THEN 'Gym Trial' ELSE "name" END,
    "slug" = CASE WHEN "slug" = 'free-trial' THEN 'gym-trial' ELSE "slug" END
WHERE "is_trial";

-- Replaced by the per-kind trial shape and index below.
ALTER TABLE "plans" DROP CONSTRAINT "plans_trial_shape_check";
DROP INDEX "plans_one_active_trial_key";
ALTER TABLE "plans" DROP COLUMN "is_trial";

-- Plans
ALTER TABLE "plans"
  ADD CONSTRAINT "plans_duration_mode_check" CHECK (("billing" = 'ONE_TIME') = ("duration_mode" IS NOT NULL)),
  ADD CONSTRAINT "plans_calendar_days_check" CHECK ("duration_mode" IS DISTINCT FROM 'CALENDAR_DAYS' OR "duration_days" IS NOT DISTINCT FROM 1),
  ADD CONSTRAINT "plans_trial_shape_check" CHECK (
    "trial_kind" IS NULL OR (
      "price_cents" = 0
      AND "billing" = 'ONE_TIME'
      AND "stripe_product_id" IS NULL
      AND "stripe_price_id" IS NULL
      AND "max_members" = 1
      AND COALESCE(CASE "trial_kind"
        WHEN 'GYM' THEN
          "type" = 'BASE' AND "open_access" AND "class_access" = 'NONE'
          AND "duration_mode" = 'CALENDAR_DAYS' AND "duration_days" = 1
        WHEN 'CLASS' THEN
          "type" = 'ADDON' AND NOT "open_access" AND "class_access" = 'CREDITS' AND "credits" = 1
          AND "duration_mode" = 'ROLLING' AND "duration_days" = 7
      END, FALSE)
    )
  );

CREATE UNIQUE INDEX "plans_one_active_trial_per_kind_key" ON "plans" ("trial_kind") WHERE "trial_kind" IS NOT NULL AND "active";

-- Membership invites: a revoked invite without a revoker was revoked by the
-- system when its membership ended.
ALTER TABLE "membership_invites"
  ADD CONSTRAINT "membership_invites_revoked_check" CHECK (("status" = 'REVOKED') = ("revoked_at" IS NOT NULL)),
  ADD CONSTRAINT "membership_invites_revoked_by_check" CHECK ("revoked_by_id" IS NULL OR "revoked_at" IS NOT NULL),
  ADD CONSTRAINT "membership_invites_expiry_check" CHECK ("expires_at" > "created_at");
