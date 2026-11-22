# FitGate — Product Spec

Gym management web app for a single gym (multi-gym is out of scope for v1).
Members get open gym access and/or class access depending on their plan.

The gym is in Lebanon: gym time zone `Asia/Beirut` (observes DST), currency USD.

## Roles
- **Member** — buys a plan, checks in, books classes, sees own history.
- **Trainer** — sees and manages own classes, marks attendance.
- **Admin** — manages plans, members, classes, trainers; sees analytics; scans check-ins.

## Plans
A plan defines what a membership grants.

| Field | Meaning |
|---|---|
| `type` | `BASE` (main membership) or `ADDON` (bought on top of, or without, a base plan) |
| `openAccess` | Can enter the gym freely |
| `classAccess` | `NONE`, `UNLIMITED`, or `CREDITS` |
| `credits` | Class credits granted (when `CREDITS`) |
| `billing` | `RECURRING` or `ONE_TIME` |
| `intervalMonths` | Billing period for recurring plans: 1, 3, 6, or 12 |
| `durationDays` | For one-time plans (e.g. day pass = 1) |
| `priceCents` | Price per billing period in integer cents (USD) |
| `maxMembers` | People covered by one membership (1 = single, 2 = couple) |
| `active` | Whether new members can buy it (old plans stay valid for existing members) |

Example plans: Basic (open access), Premium (open + unlimited classes),
Day Pass (1 day open access), Class Pack (add-on, see below).

### Base plans and add-ons
- A person has at most one active `BASE` membership at a time.
- `ADDON` plans can be held alongside a base membership, or on their own.
- **Class Pack** (add-on): one-time purchase, 10 credits, valid 60 days,
  no open access. Members buy it to add classes to a plan without classes
  (e.g. Basic + Class Pack); non-members buy it to come for classes only.
- When booking, a person with `UNLIMITED` class access never uses credits;
  otherwise credits are taken from the active pack that expires soonest.

### Entry rules
- **Open access** (e.g. Basic, Premium, Day Pass): check-in allowed any time
  during opening hours.
- **Class-only** (Class Pack, no open-access base plan): check-in allowed only
  for a class they have booked, from 30 minutes before start until 15 minutes
  after start. The check-in marks the booking `ATTENDED` and auto-closes when
  the class ends. No free gym use outside it.

### Bundles and offers
- **Multi-month plans:** the same plan sold for 3, 6, or 12 months at a lower
  monthly price (e.g. Basic: 30/month, 81 per 3 months, 288 per year).
  Each is its own plan row with its own `intervalMonths` and `priceCents`.
- **Couples plan:** available as Couples Basic and Couples Premium, monthly
  only in v1. One membership with `maxMembers = 2`. The buyer pays and
  invites a second person by email; both get their own account, QR code, and
  check-in history, sharing one membership status. Removing the partner frees
  the seat.
- **Promo codes:** time-limited discounts (e.g. 20% off the first month) handled
  with Stripe coupons and promotion codes, created by the admin.

### Free trial
- One-time base plan: 1 day of open access plus 1 class booking, price 0,
  no Stripe payment.
- One trial per person: only accounts that never had a trial or any
  membership can start one (verified email required; verified phone optional
  later to limit abuse).
- When the trial ends, the app offers Basic or Premium, optionally with a
  first-month promo code.

### Seed plans (demo and tests)
Prices are placeholders in USD, editable by the admin; not final.

| Plan | Type | Open access | Classes | Billing | Price |
|---|---|---|---|---|---|
| Basic | BASE | Yes | NONE | Recurring, 1 month | 30 |
| Basic 3 months | BASE | Yes | NONE | Recurring, 3 months | 81 |
| Basic Yearly | BASE | Yes | NONE | Recurring, 12 months | 288 |
| Premium | BASE | Yes | UNLIMITED | Recurring, 1 month | 50 |
| Premium 3 months | BASE | Yes | UNLIMITED | Recurring, 3 months | 135 |
| Premium Yearly | BASE | Yes | UNLIMITED | Recurring, 12 months | 480 |
| Couples Basic | BASE | Yes | NONE | Recurring, 1 month, 2 people | 50 |
| Couples Premium | BASE | Yes | UNLIMITED | Recurring, 1 month, 2 people | 85 |
| Day Pass | BASE | Yes (1 day) | NONE | One-time, 1 day | 10 |
| Free Trial | BASE | Yes (1 day) | CREDITS (1) | One-time, 1 day | 0 |
| Class Pack | ADDON | No | CREDITS (10) | One-time, 60 days | 70 |

## Modules

### 1. Auth & users
- Email/password sign-up and login (Better Auth), email verification required
  before sign-in. Passwords 10–128 characters. Password reset by single-use link
  (1 hour) signs the user out everywhere.
- Signing up with an existing email returns the same response and emails the
  owner instead (no account-existence leak).
- Sessions: database-backed, 7 days, refreshed daily, `HttpOnly`, `SameSite=Lax`,
  `Secure` over https. No cookie cache, so revocations and role changes apply
  on the next request.
- Role-based access, enforced on the server.
- Admin can change roles (`/admin/users`). At least one active admin always
  remains. Demoting someone revokes their sessions. Demoting to member is
  blocked while they have upcoming classes or active class templates.
- Admin can invite trainers by email (`/admin/trainers`): the link is valid
  7 days and single use. The invitee signs in or signs up with that email and
  accepts; an admin who accepts stays admin. Invites can be revoked or resent.
- The first admin is created with `npm run auth:create-admin`.
- Every role change and invite action is audit-logged.

### 2. Memberships & billing
- Member chooses a plan and pays via Stripe Checkout (test mode).
- Subscriptions renew automatically; one-time plans expire after `durationDays`.
- Membership status: `ACTIVE`, `PAST_DUE`, `FROZEN`, `CANCELLED`, `EXPIRED`.
- Failed payment → `PAST_DUE` with a grace period (3 days), then access denied.
- Member can cancel (effective at period end) and freeze (admin-approved, max 30 days).
- Stripe webhooks drive status changes; handlers verify signatures and are idempotent.
- **Memberships are non-refundable.** There is no refund feature or refund request
  flow for members. Stripe cancellations take effect at period end with no proration.
  Refunds or disputes made outside the app (Stripe dashboard, chargebacks) arrive via
  webhook and are only recorded, so revenue stays accurate; they do not change the
  membership automatically.

**Membership usability.** A membership grants access at time `t` only if it is
`ACTIVE` and `currentPeriodStart <= t < currentPeriodEnd`, or `PAST_DUE` and
`t < pastDueSince + 3 days`. `FROZEN`, `CANCELLED`, and `EXPIRED` never grant access.
Booking also requires that a non-auto-renewing membership (including a credit pack)
is still valid when the class starts. Access never depends on a background job having run.

**Overdue cleanup.** Purchase, manual membership creation, invite acceptance, and trial
start first end the person's non-auto-renewing memberships whose period is over
(`EXPIRED`, or `CANCELLED` for a Stripe subscription cancelled at period end, plus
`endedAt`) in the same transaction, then apply the one-base-membership rule.
Auto-renewing Stripe subscriptions are only ended by Stripe webhooks.

### Manual payments
Admins can record payments made outside Stripe.
- Methods: `CASH`, `WHISH`, `OMT`, `BANK_TRANSFER`, `OTHER`, with an optional
  `reference` (transaction number), the recording admin, and a note. The same
  method + reference cannot be recorded twice. Notes must not contain personal data.
- The amount always comes from the plan's price on the server.
- A first manual payment creates the membership (no Stripe). Manual memberships
  never auto-renew and end at period end unless a new payment extends them.
- Extension applies only to recurring plans, while the membership has not ended:
  the new period starts at the later of the current period end and now.
  One-time plans (Day Pass, Class Pack, Free Trial) are never extended; buying
  one again always creates a new membership.
- Every manual payment is audit-logged.

### Manual payment corrections
- An admin can **void** a manual payment recorded by mistake (status `VOIDED`,
  reason required). Payments are never deleted.
- In exceptional cases an admin can record a **manual refund** with a reason.
  This is an admin correction, not a member-facing refund flow.
- Only the latest valid manual payment of a membership can be voided or fully
  refunded. Voiding or a full refund rolls the membership's period end back to
  that payment's period start, or ends the membership (`CANCELLED`) if it was the
  activating payment. A partial refund changes amounts only.
- Stripe payments are never voided or refunded in the app.
- All corrections are audit-logged.

### 3. Check-in & occupancy
- Each member has a QR code in the app containing a short-lived signed token
  (rotates every 30 s) so screenshots can't be shared.
- Staff scan it on a check-in screen; server validates token + membership and
  logs a `CheckIn`, applying the entry rules above. Result shown clearly:
  allowed / denied + reason (e.g. "Class-only: no booked class right now").
- One open check-in per member at a time; check-out optional.
- Open check-ins auto-close after 4 hours.
- Live occupancy = open check-ins that have not passed their auto-close time;
  shown to members as a busy level (occupancy relative to the gym capacity set by the admin).

### 4. Classes
- Admin/trainer creates a class template (name, trainer, capacity, duration,
  weekly recurrence); sessions are generated for the coming weeks.
- A person can book a session if their base plan has `UNLIMITED` class access
  or they have credits left (from an active Class Pack or the Free Trial).
  - With credits: 1 credit deducted on booking, refunded on valid cancellation.
- Free cancellation until 2 hours before start; later = late cancel (credit kept).
- Fair-use rules (apply to everyone, including unlimited plans):
  - Max 1 class booking per day.
  - Max 3 upcoming bookings at a time (waitlist entries count).
  - 3 no-shows within 30 days → booking blocked for 7 days.
- Full session → waitlist; when a spot frees up, the first waitlisted member is
  promoted automatically and notified.
- Waitlist and credits: joining a waitlist deducts 1 credit (reserved); it is
  refunded if the person is never promoted or cancels in time. Unlimited plans
  use no credits.
- Waitlist cutoff: auto-promotion stops 1 hour before start, and nobody can join
  a waitlist after that. A spot freed later stays open for direct booking until
  start. When the session starts, remaining waitlisted bookings are cancelled
  and their reserved credit is refunded.
- Booking statuses: `BOOKED`, `WAITLISTED`, `CANCELLED`, `LATE_CANCELLED`,
  `ATTENDED`, `NO_SHOW`.
- Checking in for a booked class marks it `ATTENDED` and counts as gym entry.
- After a session ends, unattended bookings become `NO_SHOW`.

### 5. Trainer view
- List of own upcoming sessions, attendee list, mark attendance.

### 6. Admin dashboard
- Active members, new sign-ups, churn, revenue (from payments).
- Attendance by hour and weekday (peak times).
- Class fill rate and no-show rate.
- Memberships expiring soon.

## Data model
Source of truth: `prisma/schema.prisma`. CHECK constraints and partial unique
indexes live as raw SQL in the migrations.

- `User`, `Session`, `Account`, `Verification` — Better Auth tables; `User` adds
  role, phone, Stripe customer id, booking block, and `anonymizedAt` (GDPR).
- `TrainerInvite` (email, hashed token, inviter, status PENDING | ACCEPTED |
  REVOKED | EXPIRED, expiresAt, acceptance and revocation details); one pending
  invite per email.
- `GymSettings` (singleton: name, time zone, capacity) and `OpeningHours` (per weekday).
- `Plan` — as described under Plans, plus `isTrial`, `sortOrder`, Stripe product/price ids.
- `Membership` (owner, plan, source: STRIPE | MANUAL | TRIAL, status, period dates,
  cancelAtPeriodEnd, pastDueSince, endedAt, Stripe ids, createdBy for manual).
- `MembershipMember` (membership, user, role OWNER | PARTNER, plan type, joinedAt,
  endedAt) — who is covered; one active base seat per person.
- `MembershipInvite` (membership, email, hashed token, status, expiresAt).
- `MembershipFreeze` (dates, status, requester, admin decision).
- `TrialRedemption` (user, membership, hashed email/phone) — one trial per person.
- `Payment` (membership, payer, method, status, amount and refunded amount,
  covered period, Stripe ids, manual reference/recorder/note, void and refund details).
- `StripeEvent` (processed webhook event ids, for idempotency).
- `CheckIn` (user, membership, booking for class entries, source QR | CLASS,
  enteredAt, autoCloseAt, exitedAt, close reason) — one open check-in per member.
- `ClassTemplate` (name, trainer, capacity, duration, weekdays, local start time, validity).
- `ClassSession` (template, trainer, startsAt/endsAt, capacity, status).
- `Booking` (session, user, status, cancel reason) — waitlist order by creation time.
- `CreditLedger` (membership, user, delta, reason, booking) — balance = sum of deltas;
  at most one debit and one refund per booking.
- `AuditLog` (actor, action, target, details without personal data, createdAt).

## Key business rules
- Access is checked on the server for every check-in and booking.
- A session can never exceed capacity, even with concurrent bookings
  (transaction + row lock on the session).
- Credit balance never goes negative; every change is a ledger entry.
- Membership usability is checked from stored dates and status at request time
  (see Memberships & billing), never only by background jobs.
- All times stored in UTC; gym time zone used for display and recurrence.
- Money stored as integer cents.

## Security
- Auth via Better Auth: hashed passwords, email verification, secure session
  cookies; password reset by single-use, expiring links.
- Every request checks role and ownership: users only access their own data,
  whatever ID is sent.
- Prices always come from the server's plan record, never from the client.
- Invite and reset tokens are single-use, expire, and are stored hashed.
- Sensitive admin actions (role changes, freezes, manual membership edits, manual
  payments, voids, manual refunds) are written to an audit log in the same
  transaction as the change.
- Account deletion (GDPR): personal data is removed or anonymized; payment and
  attendance records are kept anonymized for the gym's accounting.
- Secrets only in environment variables; never logged. Card data is handled
  by Stripe Checkout and never reaches the server.

## Non-functional requirements
- Deployed on Vercel + Neon, with a seeded demo account per role.
- Tests for booking/capacity (including concurrency), waitlist promotion,
  credits, access rules, and webhook handling.
- CI on GitHub Actions: lint, type check, tests on every PR.
- Input validated with Zod; rate limiting on auth and check-in endpoints.
  Auth limits (sliding window, Redis with an in-memory fallback): sign-in
  5 / 15 min per IP + email and 20 / 15 min per IP; sign-up 5 / hour per IP;
  reset request 3 / hour per email and 10 / hour per IP; reset 10 / 15 min per IP;
  sign-up emails 3 / hour per address; trial start 3 / day per user and 10 / day
  per IP. Limited requests get 429 with `Retry-After`. Rate-limit keys hold only
  HMAC-hashed identifiers.
- Responsive UI (members use phones; check-in screen used on a tablet).

## Milestones
1. Foundation: auth, roles, database schema, plans, deployment pipeline.
2. Billing: Stripe checkout, subscriptions (incl. multi-month plans and promo
   codes), webhooks, membership status. Couples plans can come at the end of
   this milestone or after milestone 4.
3. Check-in: QR tokens, scan screen, occupancy.
4. Classes: templates, sessions, booking, waitlist, credits, tests.
5. Trainer view, admin dashboard, CI, README, demo data.

## Out of scope for v1
Multiple gyms, mobile native app, personal training slots, workout logs,
in-app chat, door hardware integration.
