-- CreateEnum
CREATE TYPE "role" AS ENUM ('MEMBER', 'TRAINER', 'ADMIN');

-- CreateEnum
CREATE TYPE "plan_type" AS ENUM ('BASE', 'ADDON');

-- CreateEnum
CREATE TYPE "class_access" AS ENUM ('NONE', 'UNLIMITED', 'CREDITS');

-- CreateEnum
CREATE TYPE "billing_type" AS ENUM ('RECURRING', 'ONE_TIME');

-- CreateEnum
CREATE TYPE "membership_status" AS ENUM ('ACTIVE', 'PAST_DUE', 'FROZEN', 'CANCELLED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "membership_source" AS ENUM ('STRIPE', 'MANUAL', 'TRIAL');

-- CreateEnum
CREATE TYPE "member_role" AS ENUM ('OWNER', 'PARTNER');

-- CreateEnum
CREATE TYPE "invite_status" AS ENUM ('PENDING', 'ACCEPTED', 'REVOKED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "freeze_status" AS ENUM ('REQUESTED', 'APPROVED', 'REJECTED', 'CANCELLED', 'COMPLETED');

-- CreateEnum
CREATE TYPE "payment_method" AS ENUM ('STRIPE', 'CASH', 'WHISH', 'OMT', 'BANK_TRANSFER', 'OTHER');

-- CreateEnum
CREATE TYPE "payment_status" AS ENUM ('PENDING', 'SUCCEEDED', 'FAILED', 'PARTIALLY_REFUNDED', 'REFUNDED', 'DISPUTED', 'VOIDED');

-- CreateEnum
CREATE TYPE "check_in_source" AS ENUM ('QR', 'CLASS');

-- CreateEnum
CREATE TYPE "check_in_close_reason" AS ENUM ('MANUAL', 'AUTO_TIMEOUT', 'CLASS_ENDED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "session_status" AS ENUM ('SCHEDULED', 'CANCELLED', 'COMPLETED');

-- CreateEnum
CREATE TYPE "booking_status" AS ENUM ('BOOKED', 'WAITLISTED', 'CANCELLED', 'LATE_CANCELLED', 'ATTENDED', 'NO_SHOW');

-- CreateEnum
CREATE TYPE "booking_cancel_reason" AS ENUM ('MEMBER', 'ADMIN', 'SESSION_CANCELLED', 'WAITLIST_EXPIRED');

-- CreateEnum
CREATE TYPE "credit_reason" AS ENUM ('GRANT', 'BOOKING_DEBIT', 'CANCELLATION_REFUND', 'WAITLIST_REFUND', 'ADMIN_ADJUSTMENT', 'EXPIRY');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "email_verified" BOOLEAN NOT NULL DEFAULT false,
    "image" TEXT,
    "role" "role" NOT NULL DEFAULT 'MEMBER',
    "phone" TEXT,
    "phone_verified" BOOLEAN NOT NULL DEFAULT false,
    "stripe_customer_id" TEXT,
    "booking_blocked_until" TIMESTAMPTZ(3),
    "anonymized_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "user_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounts" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "provider_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "access_token" TEXT,
    "refresh_token" TEXT,
    "id_token" TEXT,
    "access_token_expires_at" TIMESTAMPTZ(3),
    "refresh_token_expires_at" TIMESTAMPTZ(3),
    "scope" TEXT,
    "password" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verifications" (
    "id" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "verifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gym_settings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "name" TEXT NOT NULL,
    "time_zone" TEXT NOT NULL,
    "capacity" INTEGER NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "gym_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "opening_hours" (
    "id" UUID NOT NULL,
    "weekday" INTEGER NOT NULL,
    "opens_at_min" INTEGER NOT NULL,
    "closes_at_min" INTEGER NOT NULL,

    CONSTRAINT "opening_hours_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plans" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "type" "plan_type" NOT NULL,
    "open_access" BOOLEAN NOT NULL,
    "class_access" "class_access" NOT NULL,
    "credits" INTEGER,
    "billing" "billing_type" NOT NULL,
    "interval_months" INTEGER,
    "duration_days" INTEGER,
    "price_cents" INTEGER NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'usd',
    "max_members" INTEGER NOT NULL DEFAULT 1,
    "is_trial" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "stripe_product_id" TEXT,
    "stripe_price_id" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "memberships" (
    "id" UUID NOT NULL,
    "owner_id" TEXT NOT NULL,
    "plan_id" UUID NOT NULL,
    "source" "membership_source" NOT NULL,
    "status" "membership_status" NOT NULL,
    "created_by_id" TEXT,
    "starts_at" TIMESTAMPTZ(3) NOT NULL,
    "current_period_start" TIMESTAMPTZ(3) NOT NULL,
    "current_period_end" TIMESTAMPTZ(3) NOT NULL,
    "cancel_at_period_end" BOOLEAN NOT NULL DEFAULT false,
    "cancelled_at" TIMESTAMPTZ(3),
    "ended_at" TIMESTAMPTZ(3),
    "past_due_since" TIMESTAMPTZ(3),
    "stripe_subscription_id" TEXT,
    "stripe_checkout_session_id" TEXT,
    "stripe_last_event_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "membership_members" (
    "id" UUID NOT NULL,
    "membership_id" UUID NOT NULL,
    "user_id" TEXT NOT NULL,
    "role" "member_role" NOT NULL,
    "plan_type" "plan_type" NOT NULL,
    "joined_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ended_at" TIMESTAMPTZ(3),

    CONSTRAINT "membership_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "membership_invites" (
    "id" UUID NOT NULL,
    "membership_id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "invited_by_id" TEXT NOT NULL,
    "status" "invite_status" NOT NULL DEFAULT 'PENDING',
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "accepted_at" TIMESTAMPTZ(3),
    "accepted_by_id" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "membership_invites_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "membership_freezes" (
    "id" UUID NOT NULL,
    "membership_id" UUID NOT NULL,
    "requested_by_id" TEXT NOT NULL,
    "starts_at" TIMESTAMPTZ(3) NOT NULL,
    "ends_at" TIMESTAMPTZ(3) NOT NULL,
    "status" "freeze_status" NOT NULL DEFAULT 'REQUESTED',
    "decided_by_id" TEXT,
    "decided_at" TIMESTAMPTZ(3),
    "reason" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "membership_freezes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trial_redemptions" (
    "id" UUID NOT NULL,
    "user_id" TEXT NOT NULL,
    "membership_id" UUID NOT NULL,
    "email_hash" TEXT NOT NULL,
    "phone_hash" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trial_redemptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL,
    "membership_id" UUID,
    "user_id" TEXT NOT NULL,
    "method" "payment_method" NOT NULL,
    "status" "payment_status" NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "amount_refunded_cents" INTEGER NOT NULL DEFAULT 0,
    "currency" CHAR(3) NOT NULL DEFAULT 'usd',
    "period_start" TIMESTAMPTZ(3),
    "period_end" TIMESTAMPTZ(3),
    "paid_at" TIMESTAMPTZ(3),
    "stripe_invoice_id" TEXT,
    "stripe_payment_intent_id" TEXT,
    "stripe_checkout_session_id" TEXT,
    "reference" TEXT,
    "recorded_by_id" TEXT,
    "note" TEXT,
    "voided_at" TIMESTAMPTZ(3),
    "voided_by_id" TEXT,
    "void_reason" TEXT,
    "refunded_at" TIMESTAMPTZ(3),
    "refunded_by_id" TEXT,
    "refund_reason" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stripe_events" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "stripe_created_at" TIMESTAMPTZ(3) NOT NULL,
    "processed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stripe_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "check_ins" (
    "id" UUID NOT NULL,
    "user_id" TEXT NOT NULL,
    "membership_id" UUID NOT NULL,
    "booking_id" UUID,
    "source" "check_in_source" NOT NULL,
    "scanned_by_id" TEXT,
    "entered_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "auto_close_at" TIMESTAMPTZ(3) NOT NULL,
    "exited_at" TIMESTAMPTZ(3),
    "close_reason" "check_in_close_reason",

    CONSTRAINT "check_ins_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "class_templates" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "trainer_id" TEXT NOT NULL,
    "capacity" INTEGER NOT NULL,
    "duration_min" INTEGER NOT NULL,
    "weekdays" INTEGER[],
    "start_min_local" INTEGER NOT NULL,
    "valid_from" TIMESTAMPTZ(3) NOT NULL,
    "valid_until" TIMESTAMPTZ(3),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "class_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "class_sessions" (
    "id" UUID NOT NULL,
    "template_id" UUID NOT NULL,
    "trainer_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "starts_at" TIMESTAMPTZ(3) NOT NULL,
    "ends_at" TIMESTAMPTZ(3) NOT NULL,
    "capacity" INTEGER NOT NULL,
    "status" "session_status" NOT NULL DEFAULT 'SCHEDULED',
    "cancelled_at" TIMESTAMPTZ(3),
    "cancel_reason" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "class_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bookings" (
    "id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "user_id" TEXT NOT NULL,
    "status" "booking_status" NOT NULL,
    "cancel_reason" "booking_cancel_reason",
    "promoted_at" TIMESTAMPTZ(3),
    "cancelled_at" TIMESTAMPTZ(3),
    "attended_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "bookings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "credit_ledger" (
    "id" UUID NOT NULL,
    "membership_id" UUID NOT NULL,
    "user_id" TEXT NOT NULL,
    "delta" INTEGER NOT NULL,
    "reason" "credit_reason" NOT NULL,
    "booking_id" UUID,
    "actor_id" TEXT,
    "note" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "credit_ledger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "actor_id" TEXT,
    "action" TEXT NOT NULL,
    "target_type" TEXT NOT NULL,
    "target_id" TEXT NOT NULL,
    "details" JSONB NOT NULL DEFAULT '{}',
    "ip_hash" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_stripe_customer_id_key" ON "users"("stripe_customer_id");

-- CreateIndex
CREATE INDEX "users_role_idx" ON "users"("role");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_token_key" ON "sessions"("token");

-- CreateIndex
CREATE INDEX "sessions_user_id_idx" ON "sessions"("user_id");

-- CreateIndex
CREATE INDEX "accounts_user_id_idx" ON "accounts"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "accounts_provider_id_account_id_key" ON "accounts"("provider_id", "account_id");

-- CreateIndex
CREATE INDEX "verifications_identifier_idx" ON "verifications"("identifier");

-- CreateIndex
CREATE UNIQUE INDEX "opening_hours_weekday_key" ON "opening_hours"("weekday");

-- CreateIndex
CREATE UNIQUE INDEX "plans_slug_key" ON "plans"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "plans_stripe_price_id_key" ON "plans"("stripe_price_id");

-- CreateIndex
CREATE INDEX "plans_active_type_sort_order_idx" ON "plans"("active", "type", "sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "memberships_stripe_subscription_id_key" ON "memberships"("stripe_subscription_id");

-- CreateIndex
CREATE UNIQUE INDEX "memberships_stripe_checkout_session_id_key" ON "memberships"("stripe_checkout_session_id");

-- CreateIndex
CREATE INDEX "memberships_owner_id_idx" ON "memberships"("owner_id");

-- CreateIndex
CREATE INDEX "memberships_plan_id_idx" ON "memberships"("plan_id");

-- CreateIndex
CREATE INDEX "memberships_status_current_period_end_idx" ON "memberships"("status", "current_period_end");

-- CreateIndex
CREATE INDEX "membership_members_user_id_ended_at_idx" ON "membership_members"("user_id", "ended_at");

-- CreateIndex
CREATE INDEX "membership_members_membership_id_idx" ON "membership_members"("membership_id");

-- CreateIndex
CREATE UNIQUE INDEX "membership_invites_token_hash_key" ON "membership_invites"("token_hash");

-- CreateIndex
CREATE INDEX "membership_invites_email_idx" ON "membership_invites"("email");

-- CreateIndex
CREATE INDEX "membership_invites_membership_id_status_idx" ON "membership_invites"("membership_id", "status");

-- CreateIndex
CREATE INDEX "membership_freezes_membership_id_status_idx" ON "membership_freezes"("membership_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "trial_redemptions_user_id_key" ON "trial_redemptions"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "trial_redemptions_membership_id_key" ON "trial_redemptions"("membership_id");

-- CreateIndex
CREATE UNIQUE INDEX "trial_redemptions_email_hash_key" ON "trial_redemptions"("email_hash");

-- CreateIndex
CREATE UNIQUE INDEX "trial_redemptions_phone_hash_key" ON "trial_redemptions"("phone_hash");

-- CreateIndex
CREATE UNIQUE INDEX "payments_stripe_invoice_id_key" ON "payments"("stripe_invoice_id");

-- CreateIndex
CREATE UNIQUE INDEX "payments_stripe_payment_intent_id_key" ON "payments"("stripe_payment_intent_id");

-- CreateIndex
CREATE UNIQUE INDEX "payments_stripe_checkout_session_id_key" ON "payments"("stripe_checkout_session_id");

-- CreateIndex
CREATE INDEX "payments_membership_id_created_at_idx" ON "payments"("membership_id", "created_at");

-- CreateIndex
CREATE INDEX "payments_user_id_idx" ON "payments"("user_id");

-- CreateIndex
CREATE INDEX "payments_status_paid_at_idx" ON "payments"("status", "paid_at");

-- CreateIndex
CREATE INDEX "payments_method_paid_at_idx" ON "payments"("method", "paid_at");

-- CreateIndex
CREATE INDEX "stripe_events_type_stripe_created_at_idx" ON "stripe_events"("type", "stripe_created_at");

-- CreateIndex
CREATE UNIQUE INDEX "check_ins_booking_id_key" ON "check_ins"("booking_id");

-- CreateIndex
CREATE INDEX "check_ins_entered_at_idx" ON "check_ins"("entered_at");

-- CreateIndex
CREATE INDEX "check_ins_user_id_entered_at_idx" ON "check_ins"("user_id", "entered_at");

-- CreateIndex
CREATE INDEX "class_templates_trainer_id_idx" ON "class_templates"("trainer_id");

-- CreateIndex
CREATE INDEX "class_templates_active_idx" ON "class_templates"("active");

-- CreateIndex
CREATE INDEX "class_sessions_starts_at_idx" ON "class_sessions"("starts_at");

-- CreateIndex
CREATE INDEX "class_sessions_trainer_id_starts_at_idx" ON "class_sessions"("trainer_id", "starts_at");

-- CreateIndex
CREATE UNIQUE INDEX "class_sessions_template_id_starts_at_key" ON "class_sessions"("template_id", "starts_at");

-- CreateIndex
CREATE INDEX "bookings_session_id_status_created_at_idx" ON "bookings"("session_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "bookings_user_id_status_idx" ON "bookings"("user_id", "status");

-- CreateIndex
CREATE INDEX "credit_ledger_membership_id_idx" ON "credit_ledger"("membership_id");

-- CreateIndex
CREATE INDEX "credit_ledger_user_id_created_at_idx" ON "credit_ledger"("user_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "credit_ledger_booking_id_reason_key" ON "credit_ledger"("booking_id", "reason");

-- CreateIndex
CREATE INDEX "audit_logs_target_type_target_id_created_at_idx" ON "audit_logs"("target_type", "target_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_actor_id_created_at_idx" ON "audit_logs"("actor_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_action_created_at_idx" ON "audit_logs"("action", "created_at");

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "membership_members" ADD CONSTRAINT "membership_members_membership_id_fkey" FOREIGN KEY ("membership_id") REFERENCES "memberships"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "membership_members" ADD CONSTRAINT "membership_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "membership_invites" ADD CONSTRAINT "membership_invites_membership_id_fkey" FOREIGN KEY ("membership_id") REFERENCES "memberships"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "membership_invites" ADD CONSTRAINT "membership_invites_invited_by_id_fkey" FOREIGN KEY ("invited_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "membership_invites" ADD CONSTRAINT "membership_invites_accepted_by_id_fkey" FOREIGN KEY ("accepted_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "membership_freezes" ADD CONSTRAINT "membership_freezes_membership_id_fkey" FOREIGN KEY ("membership_id") REFERENCES "memberships"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "membership_freezes" ADD CONSTRAINT "membership_freezes_requested_by_id_fkey" FOREIGN KEY ("requested_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "membership_freezes" ADD CONSTRAINT "membership_freezes_decided_by_id_fkey" FOREIGN KEY ("decided_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trial_redemptions" ADD CONSTRAINT "trial_redemptions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trial_redemptions" ADD CONSTRAINT "trial_redemptions_membership_id_fkey" FOREIGN KEY ("membership_id") REFERENCES "memberships"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_membership_id_fkey" FOREIGN KEY ("membership_id") REFERENCES "memberships"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_recorded_by_id_fkey" FOREIGN KEY ("recorded_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_voided_by_id_fkey" FOREIGN KEY ("voided_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_refunded_by_id_fkey" FOREIGN KEY ("refunded_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "check_ins" ADD CONSTRAINT "check_ins_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "check_ins" ADD CONSTRAINT "check_ins_membership_id_fkey" FOREIGN KEY ("membership_id") REFERENCES "memberships"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "check_ins" ADD CONSTRAINT "check_ins_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "check_ins" ADD CONSTRAINT "check_ins_scanned_by_id_fkey" FOREIGN KEY ("scanned_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_templates" ADD CONSTRAINT "class_templates_trainer_id_fkey" FOREIGN KEY ("trainer_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_sessions" ADD CONSTRAINT "class_sessions_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "class_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_sessions" ADD CONSTRAINT "class_sessions_trainer_id_fkey" FOREIGN KEY ("trainer_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "class_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_ledger" ADD CONSTRAINT "credit_ledger_membership_id_fkey" FOREIGN KEY ("membership_id") REFERENCES "memberships"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_ledger" ADD CONSTRAINT "credit_ledger_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_ledger" ADD CONSTRAINT "credit_ledger_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_ledger" ADD CONSTRAINT "credit_ledger_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─── Constraints not expressible in Prisma schema ───────────────────────────
-- Keep in sync with prisma/schema.prisma. Prisma does not diff CHECK
-- constraints or partial indexes; changes go in a new migration.

-- Gym configuration
ALTER TABLE "gym_settings"
  ADD CONSTRAINT "gym_settings_singleton_check" CHECK ("id" = 1),
  ADD CONSTRAINT "gym_settings_capacity_check" CHECK ("capacity" > 0);

ALTER TABLE "opening_hours"
  ADD CONSTRAINT "opening_hours_weekday_check" CHECK ("weekday" BETWEEN 1 AND 7),
  ADD CONSTRAINT "opening_hours_range_check" CHECK ("opens_at_min" >= 0 AND "opens_at_min" < "closes_at_min" AND "closes_at_min" <= 1440);

-- Plans
ALTER TABLE "plans"
  ADD CONSTRAINT "plans_billing_shape_check" CHECK (
    ("billing" = 'RECURRING' AND "interval_months" IS NOT NULL AND "interval_months" IN (1, 3, 6, 12) AND "duration_days" IS NULL)
    OR ("billing" = 'ONE_TIME' AND "duration_days" IS NOT NULL AND "duration_days" > 0 AND "interval_months" IS NULL)
  ),
  ADD CONSTRAINT "plans_credits_check" CHECK (
    ("class_access" = 'CREDITS' AND "credits" IS NOT NULL AND "credits" > 0)
    OR ("class_access" <> 'CREDITS' AND "credits" IS NULL)
  ),
  ADD CONSTRAINT "plans_price_check" CHECK ("price_cents" >= 0),
  ADD CONSTRAINT "plans_currency_check" CHECK ("currency" ~ '^[a-z]{3}$'),
  ADD CONSTRAINT "plans_max_members_check" CHECK ("max_members" BETWEEN 1 AND 2),
  ADD CONSTRAINT "plans_addon_single_check" CHECK ("type" <> 'ADDON' OR "max_members" = 1),
  ADD CONSTRAINT "plans_trial_shape_check" CHECK (
    NOT "is_trial" OR ("type" = 'BASE' AND "price_cents" = 0 AND "billing" = 'ONE_TIME' AND "stripe_price_id" IS NULL)
  );

CREATE UNIQUE INDEX "plans_one_active_trial_key" ON "plans" ("is_trial") WHERE "is_trial" AND "active";

-- Memberships
ALTER TABLE "memberships"
  ADD CONSTRAINT "memberships_period_check" CHECK ("current_period_end" > "current_period_start" AND "current_period_start" >= "starts_at"),
  ADD CONSTRAINT "memberships_stripe_source_check" CHECK (
    "source" = 'STRIPE' OR ("stripe_subscription_id" IS NULL AND "stripe_checkout_session_id" IS NULL)
  ),
  ADD CONSTRAINT "memberships_manual_creator_check" CHECK ("source" <> 'MANUAL' OR "created_by_id" IS NOT NULL),
  ADD CONSTRAINT "memberships_ended_check" CHECK (("status" IN ('CANCELLED', 'EXPIRED')) = ("ended_at" IS NOT NULL)),
  ADD CONSTRAINT "memberships_past_due_check" CHECK ("status" <> 'PAST_DUE' OR "past_due_since" IS NOT NULL),
  ADD CONSTRAINT "memberships_cancel_flag_check" CHECK (NOT "cancel_at_period_end" OR "stripe_subscription_id" IS NOT NULL);

ALTER TABLE "membership_members"
  ADD CONSTRAINT "membership_members_ended_check" CHECK ("ended_at" IS NULL OR "ended_at" >= "joined_at");

CREATE UNIQUE INDEX "membership_members_active_seat_key" ON "membership_members" ("membership_id", "user_id") WHERE "ended_at" IS NULL;
CREATE UNIQUE INDEX "membership_members_one_active_base_key" ON "membership_members" ("user_id") WHERE "plan_type" = 'BASE' AND "ended_at" IS NULL;
CREATE UNIQUE INDEX "membership_members_one_active_owner_key" ON "membership_members" ("membership_id") WHERE "role" = 'OWNER' AND "ended_at" IS NULL;

ALTER TABLE "membership_invites"
  ADD CONSTRAINT "membership_invites_email_check" CHECK ("email" = lower("email")),
  ADD CONSTRAINT "membership_invites_accepted_check" CHECK (
    ("status" = 'ACCEPTED') = ("accepted_at" IS NOT NULL AND "accepted_by_id" IS NOT NULL)
  );

CREATE UNIQUE INDEX "membership_invites_one_pending_key" ON "membership_invites" ("membership_id") WHERE "status" = 'PENDING';

ALTER TABLE "membership_freezes"
  ADD CONSTRAINT "membership_freezes_range_check" CHECK ("ends_at" > "starts_at" AND "ends_at" - "starts_at" <= INTERVAL '30 days'),
  ADD CONSTRAINT "membership_freezes_decision_check" CHECK (
    "status" NOT IN ('APPROVED', 'REJECTED', 'COMPLETED') OR ("decided_at" IS NOT NULL AND "decided_by_id" IS NOT NULL)
  );

CREATE UNIQUE INDEX "membership_freezes_one_open_key" ON "membership_freezes" ("membership_id") WHERE "status" IN ('REQUESTED', 'APPROVED');

-- Payments
ALTER TABLE "payments"
  ADD CONSTRAINT "payments_amount_check" CHECK (
    "amount_cents" >= 0 AND "amount_refunded_cents" >= 0 AND "amount_refunded_cents" <= "amount_cents"
  ),
  ADD CONSTRAINT "payments_currency_check" CHECK ("currency" ~ '^[a-z]{3}$'),
  ADD CONSTRAINT "payments_period_check" CHECK (
    ("period_start" IS NULL AND "period_end" IS NULL)
    OR ("period_start" IS NOT NULL AND "period_end" IS NOT NULL AND "period_end" > "period_start")
  ),
  ADD CONSTRAINT "payments_paid_at_check" CHECK (
    "status" NOT IN ('SUCCEEDED', 'PARTIALLY_REFUNDED', 'REFUNDED', 'DISPUTED') OR "paid_at" IS NOT NULL
  ),
  ADD CONSTRAINT "payments_refund_status_check" CHECK (
    CASE "status"
      WHEN 'PARTIALLY_REFUNDED' THEN "amount_refunded_cents" > 0 AND "amount_refunded_cents" < "amount_cents"
      WHEN 'REFUNDED' THEN "amount_refunded_cents" = "amount_cents"
      WHEN 'DISPUTED' THEN TRUE
      ELSE "amount_refunded_cents" = 0
    END
  ),
  ADD CONSTRAINT "payments_stripe_method_check" CHECK (
    "method" <> 'STRIPE' OR ("recorded_by_id" IS NULL AND "reference" IS NULL AND "status" <> 'VOIDED')
  ),
  ADD CONSTRAINT "payments_manual_method_check" CHECK (
    "method" = 'STRIPE' OR (
      "recorded_by_id" IS NOT NULL
      AND "membership_id" IS NOT NULL
      AND "period_start" IS NOT NULL
      AND "paid_at" IS NOT NULL
      AND "stripe_invoice_id" IS NULL
      AND "stripe_payment_intent_id" IS NULL
      AND "stripe_checkout_session_id" IS NULL
      AND "status" IN ('SUCCEEDED', 'PARTIALLY_REFUNDED', 'REFUNDED', 'VOIDED')
    )
  ),
  ADD CONSTRAINT "payments_void_check" CHECK (
    ("status" = 'VOIDED') = (
      "voided_at" IS NOT NULL AND "voided_by_id" IS NOT NULL
      AND "void_reason" IS NOT NULL AND length(btrim("void_reason")) > 0
    )
  ),
  ADD CONSTRAINT "payments_manual_refund_check" CHECK (
    "method" = 'STRIPE' OR "amount_refunded_cents" = 0 OR (
      "refunded_at" IS NOT NULL AND "refunded_by_id" IS NOT NULL
      AND "refund_reason" IS NOT NULL AND length(btrim("refund_reason")) > 0
    )
  );

CREATE UNIQUE INDEX "payments_method_reference_key" ON "payments" ("method", "reference") WHERE "reference" IS NOT NULL AND "status" <> 'VOIDED';

-- Check-ins
ALTER TABLE "check_ins"
  ADD CONSTRAINT "check_ins_source_booking_check" CHECK (("source" = 'CLASS') = ("booking_id" IS NOT NULL)),
  ADD CONSTRAINT "check_ins_auto_close_check" CHECK ("auto_close_at" > "entered_at"),
  ADD CONSTRAINT "check_ins_exit_check" CHECK (
    ("exited_at" IS NULL) = ("close_reason" IS NULL) AND ("exited_at" IS NULL OR "exited_at" >= "entered_at")
  );

CREATE UNIQUE INDEX "check_ins_one_open_key" ON "check_ins" ("user_id") WHERE "exited_at" IS NULL;
CREATE INDEX "check_ins_open_auto_close_idx" ON "check_ins" ("auto_close_at") WHERE "exited_at" IS NULL;

-- Classes
ALTER TABLE "class_templates"
  ADD CONSTRAINT "class_templates_capacity_check" CHECK ("capacity" > 0),
  ADD CONSTRAINT "class_templates_duration_check" CHECK ("duration_min" > 0 AND "duration_min" <= 1440),
  ADD CONSTRAINT "class_templates_start_check" CHECK ("start_min_local" BETWEEN 0 AND 1439),
  ADD CONSTRAINT "class_templates_weekdays_check" CHECK (cardinality("weekdays") > 0 AND "weekdays" <@ ARRAY[1, 2, 3, 4, 5, 6, 7]),
  ADD CONSTRAINT "class_templates_validity_check" CHECK ("valid_until" IS NULL OR "valid_until" > "valid_from");

ALTER TABLE "class_sessions"
  ADD CONSTRAINT "class_sessions_capacity_check" CHECK ("capacity" > 0),
  ADD CONSTRAINT "class_sessions_time_check" CHECK ("ends_at" > "starts_at"),
  ADD CONSTRAINT "class_sessions_cancel_check" CHECK (("status" = 'CANCELLED') = ("cancelled_at" IS NOT NULL));

ALTER TABLE "bookings"
  ADD CONSTRAINT "bookings_cancel_check" CHECK (
    ("status" IN ('CANCELLED', 'LATE_CANCELLED')) = ("cancel_reason" IS NOT NULL AND "cancelled_at" IS NOT NULL)
  ),
  ADD CONSTRAINT "bookings_late_cancel_reason_check" CHECK ("status" <> 'LATE_CANCELLED' OR "cancel_reason" = 'MEMBER'),
  ADD CONSTRAINT "bookings_attended_check" CHECK (("status" = 'ATTENDED') = ("attended_at" IS NOT NULL));

CREATE UNIQUE INDEX "bookings_one_live_per_session_key" ON "bookings" ("session_id", "user_id") WHERE "status" NOT IN ('CANCELLED', 'LATE_CANCELLED');

-- Credit ledger
ALTER TABLE "credit_ledger"
  ADD CONSTRAINT "credit_ledger_delta_check" CHECK ("delta" <> 0),
  ADD CONSTRAINT "credit_ledger_sign_check" CHECK (
    CASE "reason"
      WHEN 'GRANT' THEN "delta" > 0
      WHEN 'CANCELLATION_REFUND' THEN "delta" > 0
      WHEN 'WAITLIST_REFUND' THEN "delta" > 0
      WHEN 'BOOKING_DEBIT' THEN "delta" < 0
      WHEN 'EXPIRY' THEN "delta" < 0
      ELSE TRUE
    END
  ),
  ADD CONSTRAINT "credit_ledger_booking_reason_check" CHECK (
    "reason" NOT IN ('BOOKING_DEBIT', 'CANCELLATION_REFUND', 'WAITLIST_REFUND') OR "booking_id" IS NOT NULL
  ),
  ADD CONSTRAINT "credit_ledger_adjustment_actor_check" CHECK ("reason" <> 'ADMIN_ADJUSTMENT' OR "actor_id" IS NOT NULL);

CREATE UNIQUE INDEX "credit_ledger_one_refund_per_booking_key" ON "credit_ledger" ("booking_id") WHERE "reason" IN ('CANCELLATION_REFUND', 'WAITLIST_REFUND');
CREATE UNIQUE INDEX "credit_ledger_one_grant_per_membership_key" ON "credit_ledger" ("membership_id") WHERE "reason" = 'GRANT';

-- Audit log
ALTER TABLE "audit_logs"
  ADD CONSTRAINT "audit_logs_details_check" CHECK (jsonb_typeof("details") = 'object');