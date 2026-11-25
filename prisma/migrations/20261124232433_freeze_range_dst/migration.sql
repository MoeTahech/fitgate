-- ─── Constraints not expressible in Prisma schema ───────────────────────────
-- Keep in sync with prisma/schema.prisma. Prisma does not diff CHECK
-- constraints, partial indexes, or triggers; changes go in a new migration.

-- Membership freezes: freezes cover 1 to 30 whole local days (enforced by the
-- service). A 30-day freeze across a DST end is 30 days 1 hour long.
ALTER TABLE "membership_freezes"
  DROP CONSTRAINT "membership_freezes_range_check",
  ADD CONSTRAINT "membership_freezes_range_check" CHECK (
    "ends_at" > "starts_at" AND "ends_at" - "starts_at" <= INTERVAL '30 days 1 hour'
  );
