# Plan: Memberships and manual payments milestone

Branch: `feat/memberships` (already checked out, clean, from `main` at `bc8bf72`).
This plan gets saved as `docs/plans/memberships.md` in step 1, like `docs/plans/auth.md`.

## Context

Auth is done. Before Stripe, the gym has to sell and manage memberships at the front
desk: an admin records cash/Whish/OMT/bank-transfer payments that create or extend
memberships, corrects mistakes (void, manual refund), approves freezes, and members see
their membership, period, and credits. This milestone also adds the free trials and
couples invites. Most of the schema (memberships, seats, invites, freezes, payments,
credit ledger, trial redemptions, and their CHECKs and partial indexes) already exists in
`20261120194318_init`. What's left: a small migration for the trial redesign and invite
revocation, the services, the pages, and tests.

No new dependencies. Time-zone math uses `Intl` in a small tested helper.

## Decisions

| # | Decision |
|---|---|
| 1 | **Lapsed memberships are not extended.** A non-auto-renewing membership counts as ended once `currentPeriodEnd <= now`, even before anything marks it. Extension only works while `now < currentPeriodEnd`, so the new period always starts at the current end and coverage has no gaps. A late payer gets a new membership, and overdue cleanup closes the old one in the same transaction. Spec wording updated. |
| 2 | **Two trials replace the single Free Trial.** The **Gym Trial** (BASE, open access, no classes) is valid from when it starts until today's closing time. The end is computed from the opening hours when the trial starts and stored as `currentPeriodEnd`; a later change to the opening hours doesn't move it. The UI says "valid today until closing (HH:MM)" from that stored end, and there is a confirmation with "Not now". The **Class Trial** (ADDON, class-only, 1 credit) lasts 7 days from activation (rolling) and grants entry only for its booked class (milestone 3). Each kind can be used once per user and once per email hash. |
| 3 | **Trial eligibility goes by access type.** Gym Trial: the person never held a seat on a paid (non-trial) membership with open access. Class Trial: the person never held a seat on a paid membership with class access (UNLIMITED or CREDITS). So a past Day Pass, or any paid open-access membership without classes (e.g. Basic), blocks the Gym Trial but not the Class Trial. Memberships that were superseded or switched (decision 13) still count; a membership cancelled because its activating payment was voided or fully refunded doesn't (a partial refund still counts). |
| 4 | **How plans end.** A new plan field `durationMode` applies to one-time plans. `CALENDAR_DAYS` ends at the closing time of the start day, computed from the opening hours at start (Day Pass, Gym Trial); a CHECK limits it to `durationDays = 1`, since no multi-day passes are planned and a closing time on a later day could be undefined. `ROLLING` ends at the same local time `durationDays` later (Class Pack: 60, Class Trial: 7). Recurring plans end `intervalMonths` calendar months later at the same local time, with end-of-month clamping. All math runs in `GymSettings.timeZone` and is DST-safe. |
| 5 | **Calendar-day plans can't start after closing.** Starting a Gym Trial or recording a Day Pass is rejected with `CLOSED_FOR_TODAY` once today's closing time has passed, or when there are no opening hours today. |
| 6 | **Freezes are worked out from dates.** A job can't flip the status at the start or end of a freeze, because access must never depend on a job. So approval leaves `status` as `ACTIVE`, and the usability rule adds: "not usable while an APPROVED freeze covers t". The UI shows `FROZEN` inside the window. Approval pushes `currentPeriodEnd` back by the freeze length, and also shifts the covered periods of the membership's valid payments on or after the freeze start, so rollbacks stay correct. Spec updated. |
| 7 | **Freeze scope.** Only the owner can request a freeze, and only on recurring BASE memberships (not Day Pass, trials, or Class Pack). Freezes are whole local days, start at least 2 days ahead (the day after tomorrow or later), last 1 to 30 days, and must start before the period end. Only one freeze can be open per membership (an index already enforces this). The admin approves or rejects before the start date; a request whose start passes undecided lapses (`CANCELLED`). The owner or an admin can cancel a freeze before it starts, and approved-cancel undoes the shift. A freeze that has started can't be ended early in this milestone. |
| 8 | **Corrections.** Void applies only to a `SUCCEEDED` payment with nothing refunded. Each payment gets at most one manual refund, either partial or full. Void and full refund are only allowed on the latest valid payment (`SUCCEEDED` or `PARTIALLY_REFUNDED`, newest `periodStart`). They roll `currentPeriodEnd` back to that payment's `periodStart`, or set the membership to `CANCELLED` if it was the activating payment. Open freezes that would start at or after the new end are cancelled. If the rollback leaves the period over, cleanup ends the membership in the same transaction. On a membership that has already ended, a correction changes only the payment. Stripe payments are rejected. |
| 9 | **One-base rule and seats.** Every membership has an OWNER seat. A couples partner gets a PARTNER seat with planType `BASE`. Ending a membership ends all its open seats, revokes its pending invites, and settles its freezes. The existing `membership_members_one_active_base_key` index is the backstop. |
| 10 | **Couples invites.** The owner sends invites from their membership page; the admin can see and revoke them. Invites are valid 7 days, single use, and stored hashed. The accepter's verified email must match the invite. Creating an invite never reveals whether the email already holds a seat: that is only checked at acceptance (`HAS_ACTIVE_BASE`, shown to the accepter). The owner or an admin can remove the partner, the partner can leave, and either frees the seat. Sending and resending are rate limited with a new policy, `membershipInvite`, at 10 per day per user. |
| 11 | **Locking.** Lock order is User, then Membership, then Payment/Freeze/Invite rows. Admin services lock the actor and the member in one `ORDER BY id FOR UPDATE`, then check inside the transaction that the actor is still an ADMIN and not anonymized (same as `roles.ts`). Overdue cleanup locks the person's seated memberships in id order. Unique-violation errors are mapped to domain codes (`HAS_ACTIVE_BASE`, `DUPLICATE_REFERENCE`, `TRIAL_ALREADY_USED`). |
| 12 | **Free text.** Payment notes and void/refund/rejection reasons are trimmed and capped at 500 characters. Zod rejects anything containing an email address or a URL, and the UI hint says no personal data. Notes, references, reasons, and emails never go into audit details. |
| 13 | **Replacing an open base on manual create.** When the member already has an open BASE seat, `createManualMembership` resolves it in this order, all in its transaction: (a) the open base is a TRIAL membership or a Day Pass (one-time `CALENDAR_DAYS`) and the new plan is a recurring BASE plan: end it now (`CANCELLED`, `endedAt = now`, audit `membership.ended` `{ status, via: "superseded" }`), no confirmation needed. (b) The open base is a MANUAL recurring membership the member owns, on a different plan, and the new plan is a recurring BASE plan: allowed only with `confirmSwitch: true`, which ends it now (`CANCELLED`, `endedAt = now`, audit `membership.ended` `{ status, via: "switched", fromPlanId, toPlanId }`) and then creates the new one. Without the flag it fails with `HAS_ACTIVE_BASE` and `{ reason: "SWITCH_NEEDS_CONFIRMATION", remainingDays, hasPartner }`, so the UI can show "X days left will be lost" and, for Couples, "the partner will be removed". `remainingDays` is the usable time left (`currentPeriodEnd - now`, minus the part of an approved freeze not yet elapsed), rounded up to whole days on the gym's wall clock (a DST change doesn't add or remove a day). Paid time is not refunded. (c) Same plan: `SAME_PLAN` (use Extend). (d) Anything else stays `HAS_ACTIVE_BASE`, with a `reason` for the UI: a one-time base plan (e.g. a Day Pass) on an open manual recurring base (`SWITCH_TARGET_NOT_RECURRING`; `confirmSwitch` does not override it), a Day Pass on an open Trial or Day Pass (same day; `DAY_PASS_OR_TRIAL`), a STRIPE base (`STRIPE_BASE`), another manual one-time base plan (`ONE_TIME_BASE`), or a member who is only the PARTNER on someone else's membership (`PARTNER_SEAT`; the owner's membership is never ended by the partner's purchase). Scheduled switches at period end are deferred to the Stripe milestone. |
| 14 | **Explicit time.** Each service takes one `now` and passes every timestamp explicitly from it, including `createdAt` on the rows it inserts. No SQL `now()`/`CURRENT_TIMESTAMP` and no column defaults in time-dependent logic, queries, or constraints (e.g. `expires_at > created_at`). Tests fake only the JS `Date`, so anything the database computes would use the real clock. |

## 1. Migration `memberships` (`--create-only` + raw SQL)

Prisma schema:
- `enum TrialKind { GYM CLASS }`, `enum DurationMode { ROLLING CALENDAR_DAYS }`.
- `Plan`: add `trialKind TrialKind?` and `durationMode DurationMode?`, and **drop `isTrial`**.
  It's only used in the schema, the seed, and the init migration.
- `TrialRedemption`: add `kind TrialKind`. Replace the single uniques with
  `@@unique([userId, kind])`, `@@unique([emailHash, kind])`, `@@unique([phoneHash, kind])`;
  `membershipId` stays unique. `User.trialRedemption?` becomes `trialRedemptions[]`.
- `MembershipInvite`: add `revokedAt?` and `revokedById?`, plus the relation `InviteRevoker` on `User`.

Raw SQL appended:
- Backfill before the new CHECKs:
  - `day-pass` gets `CALENDAR_DAYS`. Other one-time plans get `ROLLING`.
  - The existing `is_trial` row becomes the Gym Trial in place: slug `gym-trial`, class
    access `NONE`, credits `NULL`, `trial_kind = 'GYM'`, `CALENDAR_DAYS`. No membership can
    reference it yet, since no trial flow exists.
- Drop `plans_trial_shape_check` and `plans_one_active_trial_key`.
- New constraints:
  - `plans_duration_mode_check`: `(billing = 'ONE_TIME') = (duration_mode IS NOT NULL)`.
  - `plans_calendar_days_check`: `duration_mode IS DISTINCT FROM 'CALENDAR_DAYS' OR duration_days = 1` (decision 4).
  - `plans_trial_shape_check`: `trial_kind IS NULL OR (price 0, ONE_TIME, no Stripe ids, max_members 1 AND (GYM: BASE, open_access, NONE, CALENDAR_DAYS, duration_days = 1 | CLASS: ADDON, NOT open_access, CREDITS, credits = 1, ROLLING, duration_days = 7))`.
  - `plans_one_active_trial_per_kind_key` on `(trial_kind) WHERE trial_kind IS NOT NULL AND active`.
- `membership_invites`:
  - `(status = 'REVOKED') = (revoked_at IS NOT NULL)`.
  - `revoked_by_id IS NULL OR revoked_at IS NOT NULL`. A null `revoked_by_id` means the
    system revoked it when the membership ended.
  - `expires_at > created_at`.
- Run the drift check afterwards: it must print an empty migration.

Seed (`prisma/seed.ts`):
- Replace `free-trial` with `gym-trial` and `class-trial`, and set `durationMode` on
  Day Pass (`CALENDAR_DAYS`) and Class Pack (`ROLLING`).
- Still create-only. Existing rows get their values from the migration backfill.

## 2. Time helpers: `src/lib/time.ts` (pure, reused by classes later)

- `zonedParts(instant, tz)`: local date, time, and ISO weekday.
- `zonedToInstant(parts, tz)`: a DST gap resolves forward; an overlap takes the earlier instant.
- `addMonthsZoned`, `addDaysZoned`, `startOfZonedDay`, `localMinutes`.
- `formatLocal` / `formatLocalTime` for display (en-GB, gym tz).

## 3. Rules (pure): `src/lib/services/memberships/rules.ts`

- `isAutoRenewing(m)`: source STRIPE, plan RECURRING, and not `cancelAtPeriodEnd`.
  Manual and trial memberships are never auto-renewing.
- `isUsableAt(m, approvedFreezes, t)`: ACTIVE with `start <= t < end`, or PAST_DUE with
  `t < pastDueSince + 3d`, and no APPROVED freeze covering t. FROZEN, CANCELLED, and EXPIRED
  never grant access.
- `isOverdue(m, now)`: not ended, not auto-renewing, and `end <= now`.
  `effectiveStatus(m, freezes, now)` gives the display status: EXPIRED when overdue,
  FROZEN inside a freeze window.
- `canBookAt(m, freezes, now, classStart)`: usable now, and also at class start unless the
  membership auto-renews. This is for milestone 4; it's implemented and tested now.
- `computePeriod(plan, start, clock)` implements decision 4; `clock` is the time zone plus
  opening hours. `closingTimeOn(day, clock)` returns the closing instant of a local day (or
  none when closed); it is the `CALENDAR_DAYS` end and feeds `CLOSED_FOR_TODAY`.
- `remainingUsableMs(m, approvedFreezes, now)`, and `remainingUsableDays(..., timeZone)` for
  decision 13's `remainingDays` (local days, via `localElapsedMs`).

## 4. Shared internals: `src/lib/services/memberships/internal.ts`, `errors.ts`

- `MembershipError(code, details?)`, following the `TrainerInviteError` pattern; `details`
  carries UI data such as `HAS_ACTIVE_BASE`'s `{ reason, remainingDays?, hasPartner? }`.
- Audit helper: move the local `audit()` from
  [trainer-invites.ts](src/lib/services/trainer-invites.ts) to
  `src/lib/services/audit.ts` and reuse it in both places.
- `lockUsers(tx, ids)`, `lockMembership(tx, id)`, and `requireActiveAdmin(rows, actorId)`.
- `getGymClock(tx)`: time zone plus opening hours, falling back to `Asia/Beirut`.
- `endOverdueMemberships(tx, userId, now, trigger)`: ends the person's seated memberships
  that are overdue. Status becomes `CANCELLED` when `cancelAtPeriodEnd` is set, otherwise
  `EXPIRED`, with `endedAt = currentPeriodEnd`. Each one goes through `endMembership`.
  Audit: `membership.ended` with `{ status, via: "overdue_cleanup", trigger }` and no actor.
- `endMembership(tx, m, ...)`: ends open seats (`GREATEST(joined_at, endedAt)`), revokes
  pending invites, and settles freezes: REQUESTED and not-yet-started APPROVED ones become
  `CANCELLED`, started APPROVED ones `COMPLETED`.
- `openBaseSeat(tx, userId)` (the seat with its membership and plan) and
  `paidAccessHistory(tx, userId)`, which returns `{ openAccess, classAccess }` for decision 3.
- `resolveOpenBase(tx, { member, plan, confirmSwitch, now })` implements decision 13. It locks
  the open base membership (after the users, per the lock order) and ends it through
  `endMembership` when superseding or switching.
- Every function takes `now` from its caller (decision 14).

## 5. Manual memberships: `memberships/manual.ts`

**`createManualMembership({ actorId, userId, planId, method, reference?, note?, confirmSwitch?, ipHash })`**

All in one transaction:
1. Lock the actor and the member; the actor must be an active ADMIN, and the member must
   exist and not be anonymized.
2. The plan must be active, not a trial, and the method must not be STRIPE.
3. Run overdue cleanup for the member.
4. A calendar-day plan after closing fails with `CLOSED_FOR_TODAY` (checked before anything
   is ended). For a BASE plan with an open base seat, `resolveOpenBase` applies decision 13:
   supersede, switch with `confirmSwitch`, or fail with `HAS_ACTIVE_BASE` / `SAME_PLAN`.
5. Compute the period from now.
6. Insert the membership (MANUAL, ACTIVE, `createdById`) and the OWNER seat.
7. Insert the payment: SUCCEEDED, amount and currency taken from the plan, covered period,
   `paidAt` now, `recordedById`, method, reference, and note.
8. For CREDITS plans, add a `GRANT` ledger entry for `plan.credits`.
9. Audit `membership.created` (via `manual`) and `payment.recorded`.

The same method + reference is pre-checked, and the partial unique index is the backstop
(`DUPLICATE_REFERENCE`).

**`extendManualMembership({ actorId, membershipId, method, reference?, note?, ipHash })`**

1. Lock the actor and the owner, then the membership.
2. Run cleanup; if the membership has now ended, fail with `MEMBERSHIP_ENDED`.
3. The membership must be MANUAL and its plan RECURRING (`NOT_EXTENDABLE`). Inactive plans
   may be extended; the price comes from the plan.
4. The new period runs from `currentPeriodEnd` to `+intervalMonths`; `currentPeriodStart`
   stays the same.
5. Insert the payment.
6. Audit `membership.extended` (`{ paymentId, previousEnd, newEnd }`) and `payment.recorded`.

## 6. Corrections: `memberships/corrections.ts`

- `voidPayment({ actorId, paymentId, reason, ipHash })` and
  `refundPayment({ actorId, paymentId, amountCents, reason, ipHash })`, following decision 8.
- Lock order: actor and payer, then membership, then the payment row (`FOR UPDATE`).
- A refund amount must be at least 1 and no more than the payment amount.
- Error codes: `NOT_MANUAL`, `NOT_LATEST_PAYMENT`, `HAS_REFUND`, `ALREADY_REFUNDED`,
  `INVALID_AMOUNT`, `PAYMENT_NOT_VALID`.
- Audit `payment.voided` / `payment.refunded` (`{ amountRefundedCents, full }`), plus
  `membership.period_rolled_back` (`{ previousEnd, newEnd }`) or `membership.ended`
  (`{ status: "CANCELLED", via: "void" | "refund" }`).

## 7. Freezes: `memberships/freezes.ts`

**`requestFreeze`** (owner; from and to local dates)
- Lapses stale REQUESTED freezes first.
- Validates decision 7 (the start date must be at least today + 2 local days), converts the
  dates to local day starts (`startOfZonedDay`, so a DST gap at midnight resolves forward),
  and inserts the freeze as REQUESTED.

**`approveFreeze`** (admin)
- The freeze must be REQUESTED with `startsAt > now`, and the membership must be ACTIVE,
  not overdue, with `startsAt < currentPeriodEnd`.
- Sets APPROVED with the decision fields.
- Moves `currentPeriodEnd` back by `d = endsAt - startsAt`, and shifts valid payments:
  `period_end += d` where `period_end > startsAt`, and `period_start += d` where
  `period_start >= startsAt`.

**`rejectFreeze`** (admin, optional reason) and **`cancelFreeze`**
- Cancel works for the owner or an admin, on a REQUESTED freeze, or on an APPROVED one
  before it starts (which reverses the shift).
- COMPLETED is set lazily by any later write to the membership. For display it is worked
  out from the dates.

Audit actions: `membership_freeze.requested`, `.approved`, `.rejected`, `.cancelled`.

## 8. Trials: `memberships/trials.ts`

The server action calls `requireUser()` and passes the user id and client IP to the service.
The service checks `rateLimit("trialStartUser", userId)` and `rateLimit("trialStartIp", ip)`
(existing policies) before its transaction, so PR A's tests cover the limits. A limited
request gets a generic "Too many attempts" message.

**`startTrial({ userId, kind, ip, ipHash })`**, in one transaction:
1. Lock the user; the email must be verified and the user not anonymized.
2. Find the active trial plan of that kind, else `TRIAL_UNAVAILABLE`.
3. If a redemption exists for (user, kind) or for (`keyedHash("trial", email)`, kind),
   fail with `TRIAL_ALREADY_USED`.
4. Check paid-access history per decision 3, else `NOT_ELIGIBLE`.
5. Run overdue cleanup.
6. GYM only: an open base seat fails with `HAS_ACTIVE_BASE`; after closing, `CLOSED_FOR_TODAY`.
   The period ends at today's closing time (decision 4).
7. Insert the membership (TRIAL, ACTIVE), the OWNER seat, and the redemption
   (`kind`, `emailHash`, `phoneHash` null).
8. CLASS only: add a `GRANT` ledger entry of 1.
9. Audit `membership.trial_started` (`{ kind }`).

There is no payment row. `trialEligibility(userId)` feeds the page.

## 9. Couples invites: `memberships/invites.ts`

**`createMembershipInvite`** (owner)
- The service checks `rateLimit("membershipInvite", ownerId)` before its transaction.
- The membership must be usable, its plan must have `maxMembers = 2`, and a seat must be
  free.
- The email must not be the owner's own. Whether the email belongs to an account or holds a
  seat is not checked here, and the response is the same either way (decision 10).
- Any previous pending invite is revoked as superseded.
- The token is stored as `sha256`; the invite expires in 7 days (`createdAt` and `expiresAt`
  both set from `now`, decision 14).
- The email goes out after commit.

**`revokeMembershipInvite`** (owner or admin) and **`resendMembershipInvite`** (owner; only
the membership's most recent invite, otherwise `INVITE_NOT_LATEST`; also counts toward
`membershipInvite`).

**`acceptMembershipInvite`**, in one transaction:
1. Lock the accepter, then the membership, then the invite.
2. The invite must be PENDING and not expired, the accepter's email must match and be
   verified, and the accepter must not be the owner.
3. Run cleanup for the accepter. If the membership is overdue, end it and fail.
4. A seat must still be free, and the accepter must not have a base seat (`HAS_ACTIVE_BASE`).
5. Insert the PARTNER seat and mark the invite ACCEPTED.

**`removePartner`** (owner or admin) and **`leaveMembership`** (partner) end the seat.

Audit: `membership_invite.created`, `.revoked`, `.accepted`, plus `membership.partner_joined`,
`.partner_removed`, `.partner_left`.

The invite email template `membershipInviteEmail` goes in `src/lib/email/templates.ts`.

## 10. Read models: `memberships/queries.ts`

Every function calls `requireUser()` or `requireRole("ADMIN")`.

- `getMyMemberships()` returns only memberships where the user holds or held a seat.
  Partners don't see the owner's payments.
- Admin: `listMembers`, `getMemberDetail`, `listMemberships` (filters for effective
  status, plan, source, and expiring within 7 days; pending freeze queue showing only
  REQUESTED freezes with `startsAt > now`, since stale ones have lapsed), `getMembershipDetail`
  (seats, invite, payments, freezes, credit balance from the ledger, audit rows), and
  `listPayments` (method, status, and date-range filters; gross, refunded, and net totals,
  with VOIDED excluded).

## 11. Pages

Before writing pages, read the bundled Next 16.4.6 docs on server actions and forms
(`useActionState`), `refresh`, dynamic params with `cacheComponents`, and `io()`.
Pages are built with the UI foundation components (separate PR, merged first).
Pages follow the existing pattern: content behind `<Suspense>`, `requirePageUser` first,
`await io()` before time-dependent reads, and thin server actions that parse FormData with
Zod, call the service, map error codes to messages, and call `refresh()`.

Member pages:
- `/account/membership`
  - Current memberships: plan, effective status, period (or "valid today until closing
    (HH:MM)"), and remaining credits.
  - Couples: the partner panel for the owner (invite, revoke, resend, remove), or the
    owner's name and a Leave button for the partner.
  - Freeze request form and freeze history (owner).
  - Trial cards when eligible, with a confirmation step and "Not now".
  - Payment history (owner; no notes) and past memberships.
  - After a trial ends: active plans with a "join at the front desk" message.
- `/account`: adds a membership summary and a link.
- Site header: adds a "Membership" link.
- `/invite/membership/[token]`: the accept page, modeled on `/invite/trainer/[token]`.

Admin pages (the nav adds Members, Memberships, Payments):
- `/admin/members`: search and pagination, with the current base membership summary for
  each person.
- `/admin/members/[userId]`: profile, memberships, payments, and trial kinds used.
  - The "Record payment" form offers active non-trial plans. When the member's open base
    would be superseded (Trial, Day Pass) it says so; for a switch it asks for confirmation
    with "X days left will be lost" (and "the partner will be removed" for Couples); for the
    same plan it points to Extend; other conflicts are explained.
  - Each extendable membership gets an "Extend" form showing the price and the new end.
- `/admin/memberships`: the pending freeze queue (approve/reject) and a filtered list.
- `/admin/memberships/[id]`: seats (remove partner), pending invite (revoke), payments with
  void/refund forms on eligible rows, freezes, the credit ledger, and the audit trail.
- `/admin/payments`: filtered list and totals, with links to each membership.

After adding routes, run `npx next typegen`.

## 12. Tests

Unit (pure):
- Usability at every status, including the `start` and `end` boundaries, PAST_DUE grace,
  and freeze windows.
- `effectiveStatus` and `canBookAt`.
- Period math: month-end clamping, Beirut DST start and end, rolling days, and calendar-day
  plans ending at that day's closing time (including `closes_at_min = 1440` and a DST day).
- Closing-time lookup, including a closed day.
- Beirut's DST gap at local midnight (e.g. 2027-03-28, clocks jump from 00:00 to 01:00):
  `startOfZonedDay` on that day returns 01:00 local.
- `remainingUsableMs` with and without an approved future or running freeze.
- The free-text refine.

Integration (real DB; `vi.setSystemTime` with only `Date` faked; factories for plans,
opening hours, and memberships):
- **Manual create**
  - The amount comes from the plan; the membership, seat, payment, and audit rows are
    written, with no note or reference in the details.
  - Class Pack grants 10 credits.
  - An ADDON alongside a base is allowed.
  - A lapsed base is closed by cleanup, and a new one is then allowed.
  - Inactive and trial plans are rejected, as are STRIPE method, a non-admin actor, and an
    anonymized member.
  - A Day Pass ends at today's closing time; changing the opening hours afterwards doesn't
    move it. A Day Pass after closing, or on a closed day, is rejected.
- **Replacing an open base** (decision 13)
  - Gym Trial → Basic: the trial is `CANCELLED` with `endedAt = now`, `membership.ended`
    (`superseded`) is audited, the new membership is created, and the redemption still blocks
    another Gym Trial.
  - Day Pass → Basic supersedes the same way. A Day Pass on an open Day Pass or Gym Trial is
    rejected with `HAS_ACTIVE_BASE`.
  - Switch Basic → Premium without `confirmSwitch`: `HAS_ACTIVE_BASE` with the right
    `remainingDays` and `hasPartner: false`; nothing changes.
  - With `confirmSwitch`: the old membership is `CANCELLED` with `endedAt = now`,
    `membership.ended` (`switched`, `{ fromPlanId, toPlanId }`) is audited, its payments are
    untouched, and the new one is created.
  - Couples owner switches to Basic: without the flag `hasPartner: true`; with it the
    partner's seat ends and the pending invite is revoked.
  - Switch with an approved future freeze: `remainingDays` excludes the frozen days and the
    freeze is cancelled. With a REQUESTED freeze, it is cancelled.
  - A one-time base plan (Day Pass) on an open Basic: `HAS_ACTIVE_BASE` with
    `SWITCH_TARGET_NOT_RECURRING`, with or without `confirmSwitch`; nothing changes.
  - Same plan: `SAME_PLAN`. A member who is a Couples partner: `HAS_ACTIVE_BASE`, and the
    owner's membership is untouched. A failed `CLOSED_FOR_TODAY` ends nothing.
  - Two concurrent switches leave exactly one base.
  - A duplicate method + reference is rejected, and allowed again after a void.
  - Two concurrent creates leave exactly one base.
- **Extend**
  - The new period starts at the current end.
  - One-time plans, lapsed memberships, and TRIAL memberships are rejected.
- **Corrections**
  - Only the latest valid payment can be voided or fully refunded.
  - Voiding an extension rolls the end back. Voiding the activating payment sets CANCELLED
    and ends the seats, including the partner's, and revokes the pending invite.
  - A partial refund changes amounts only. A second refund is rejected, as is an amount
    above the payment.
  - A void on a refunded payment is rejected, as are Stripe payments.
  - A rollback into the past expires the membership.
  - A rollback cancels freezes that start beyond the new end.
- **Freezes**
  - Only the owner can request; requests must fit 1 to 30 days within the period.
  - A start tomorrow is rejected; the day after tomorrow is accepted.
  - The admin queue hides a REQUESTED freeze whose start has passed.
  - A freeze starting on Beirut's DST-start day starts at 01:00 local; the membership is
    usable just before and unusable from that instant, and approval shifts the end by exactly
    `endsAt - startsAt` (23 hours for a 1-day freeze).
  - Only one freeze can be open.
  - Approval extends the end and shifts payment periods, and the membership isn't usable
    inside the window.
  - Rejecting works. Cancelling before the start reverses the shift.
  - Approving after the start date is rejected.
  - A void after a freeze rolls back correctly.
- **Trials**
  - GYM and CLASS happy paths: GYM ends at today's closing time, CLASS 7 days later; the
    credit grant for CLASS, and no payment row.
  - Each kind works once per user, and also once per email hash (a new account with an
    anonymized user's email).
  - A past Day Pass blocks GYM but not CLASS; so does a past Basic. A paid class history
    blocks CLASS.
  - A voided-only membership doesn't block.
  - GYM with an active base is rejected. After closing, or with no opening hours, it is
    rejected.
  - Two concurrent starts give one trial.
  - The `trialStartUser` limit blocks the 4th attempt, using a unique key prefix.
- **Invites**
  - The happy path, checked against Mailpit; the token is stored hashed.
  - Non-couples plans and full seats are rejected, as are email mismatch, expired, revoked,
    an accepter with a base seat, and an ended membership.
  - Inviting an email that already holds a base seat returns the same result as any other
    email; acceptance then fails with `HAS_ACTIVE_BASE`.
  - Creates and resends share the `membershipInvite` limit: the 11th in a day is blocked
    (unique key prefix).
  - Two concurrent accepts succeed once.
  - Removing the partner frees the seat, and a new invite works.
- **Authorization**
  - Members only see their own memberships.
  - Admin queries and actions reject MEMBER and TRAINER.
- **DB constraints** (`tests/db/membership-constraints.test.ts`)
  - Trial plan shapes (including a CLASS trial that isn't `ROLLING` or not 7 days), a
    `CALENDAR_DAYS` plan longer than 1 day, one active trial per kind, redemption uniqueness
    per kind, and the invite revoke check.

## Implementation steps (one small commit each)

**PR A** (steps 1–11: schema, services, tests) on `feat/memberships`. After it merges, a
separate **UI foundation** PR on `feat/ui-foundation`, branched from `main`: design tokens,
shared components, layout, and a `CLAUDE.md` rule that pages use them (planned separately
when we get there). **PR B** (steps 12–15: pages) on `feat/memberships-ui`, branched from
`main` after the UI foundation PR merges; its pages must use those components.
`CLAUDE.md` is updated in the step where a convention first appears, not only at the end.

PR A:
1. Save this plan as `docs/plans/memberships.md`. Update `docs/spec.md`: two trials (the
   Class Trial grants entry only for its booked class, for milestone 3), trial eligibility by
   access type (a past Day Pass or other paid open-access membership blocks the Gym Trial,
   not the Class Trial), seed table, Day Pass and Gym Trial valid until today's closing time,
   the extension wording, superseding a Trial/Day Pass and switching plans on manual create,
   the freeze-aware usability rule, the 2-day freeze lead time, one refund per payment, the
   data model, and the invite rate limit (sends and resends).
2. Migration, schema, seed, and constraint tests; then the drift check and `prisma generate`.
3. `src/lib/time.ts` with tests. `CLAUDE.md`: time helpers live there and all zone math
   goes through them.
4. Rules module with tests.
5. Shared internals and audit extraction (trainer-invites tests stay green). `CLAUDE.md`:
   the `memberships/` service folder, `services/audit.ts`, `MembershipError`, and the
   explicit-time rule (decision 14).
6. Manual create (including decision 13) and extend, with tests.
7. Void and refund, with tests.
8. Freezes, with tests. New migration (via `/migration`) relaxes `membership_freezes_range_check` to `<= INTERVAL '30 days 1 hour'` (a 30-day freeze across Beirut's October DST change is 30 days 1 hour; the service enforces 1–30 whole local days), with a test for that case.
9. Trials, with tests.
10. Couples invites, email template, and accept page, with tests.
11. Read models and authorization tests. Includes the test deferred from step 8: the admin freeze queue hides stale REQUESTED freezes (`startsAt <= now`).

UI foundation PR (separate plan): design tokens, shared components, layout, `CLAUDE.md` rule.

PR B (pages use the UI foundation components):
12. Member pages.
13. Admin members pages.
14. Admin memberships and payments pages.
15. Finalize `CLAUDE.md` (page and server-action patterns for memberships) and the spec.

## Verification

PR A:
- `npm test`, `npm run lint`, `npx tsc --noEmit`, and `npm run build`. The drift diff is empty.

PR B:
- The same checks, then a manual run (`docker compose up -d`, `npm run db:deploy`,
  `npm run db:seed`, `npm run dev`):
  1. As the admin, record a Basic payment for a member, extend it, and void the extension,
     checking that the end rolls back.
  2. Record a Couples Premium membership. The member invites a partner; check the email in
     Mailpit; the partner accepts and sees the shared membership; the owner removes the partner.
  3. The member requests a freeze, the admin approves it, and the period end moves.
  4. A fresh account starts a Gym Trial (the confirmation shows the closing time) and a
     Class Trial; a second attempt is refused. The admin records Basic for that account and
     the Gym Trial is superseded; switching to Premium asks for confirmation first.
  5. Check `audit_logs`: every action has a row, with no emails, notes, or references in
     the details.

## Not in this milestone

- Stripe and promo codes.
- An admin ending a membership early other than by a switch (decision 13), and scheduled
  switches at period end (Stripe milestone).
- Ending a freeze that has started.
- Notification emails for freeze decisions.
- Admin-created accounts for walk-ins.
- Credit adjustments.
- Check-in and booking enforcement. `isUsableAt` and `canBookAt` are ready for milestones 3 and 4.
- Phone verification.
