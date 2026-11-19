# FitGate — Product Spec

Gym management web app for a single gym (multi-gym is out of scope for v1).
Members get open gym access and/or class access depending on their plan.

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
| `priceCents` | Price per billing period in integer cents |
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
Prices are placeholders in EUR, editable by the admin; not final.

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
- Email/password sign-up and login (Better Auth), email verification.
- Role-based access, enforced on the server.
- Admin can invite trainers and change roles.

### 2. Memberships & billing
- Member chooses a plan and pays via Stripe Checkout (test mode).
- Subscriptions renew automatically; one-time plans expire after `durationDays`.
- Membership status: `ACTIVE`, `PAST_DUE`, `FROZEN`, `CANCELLED`, `EXPIRED`.
- Failed payment → `PAST_DUE` with a grace period (3 days), then access denied.
- Member can cancel (effective at period end) and freeze (admin-approved, max 30 days).
- Stripe webhooks drive status changes; handlers verify signatures and are idempotent.

### 3. Check-in & occupancy
- Each member has a QR code in the app containing a short-lived signed token
  (rotates every 30 s) so screenshots can't be shared.
- Staff scan it on a check-in screen; server validates token + membership and
  logs a `CheckIn`, applying the entry rules above. Result shown clearly:
  allowed / denied + reason (e.g. "Class-only: no booked class right now").
- One open check-in per member at a time; check-out optional.
- Open check-ins auto-close after 4 hours.
- Live occupancy = open check-ins; shown to members as a busy level.

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

## Data model (draft — refine in plan mode)
- `User` (role)
- `Plan`
- `Membership` (owner user, plan, status, currentPeriodStart/End, freeze dates, stripeSubscriptionId)
- `MembershipMember` (membership, user, joinedAt) — who is covered; supports couples plans
- `MembershipInvite` (membership, email, token, expiresAt, status)
- `Payment` (membership, amountCents, status, stripe ids)
- `StripeEvent` (processed webhook event ids, for idempotency)
- `CheckIn` (user, enteredAt, exitedAt, source: QR | CLASS)
- `ClassTemplate` (name, trainer, capacity, durationMin, recurrence)
- `ClassSession` (template, startsAt, capacity, status)
- `Booking` (session, user, status, waitlistPosition)
- `CreditLedger` (membership, delta, reason, bookingId) — balance = sum of deltas
- `AuditLog` (actor user, action, target, details, createdAt)

## Key business rules
- Access is checked on the server for every check-in and booking.
- A session can never exceed capacity, even with concurrent bookings
  (transaction + row lock on the session).
- Credit balance never goes negative; every change is a ledger entry.
- All times stored in UTC; gym time zone used for display and recurrence.
- Money stored as integer cents.

## Security
- Auth via Better Auth: hashed passwords, email verification, secure session
  cookies; password reset by single-use, expiring links.
- Every request checks role and ownership: users only access their own data,
  whatever ID is sent.
- Prices always come from the server's plan record, never from the client.
- Invite and reset tokens are single-use, expire, and are stored hashed.
- Sensitive admin actions (role changes, freezes, manual membership edits) are
  written to an audit log.
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
