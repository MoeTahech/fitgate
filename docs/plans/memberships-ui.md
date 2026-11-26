# Plan: Memberships UI (PR B, steps 12–15 of `docs/plans/memberships.md`)

Branch: `feat/memberships-ui`, from `main` at `17b486d` (PR A and the UI foundation merged).
The working tree is still on `main`, so step 0 creates the branch. Step 1 saves this plan as
`docs/plans/memberships-ui.md`.

## Context

The membership services and read models are merged and tested (PR A). The UI foundation (tokens,
shared components, layout) is merged too. Nobody can use any of it yet: there are no member or
admin membership pages. This PR adds:
- the member's `/account/membership` page, built for phones first;
- the admin Members, Memberships, and Payments pages;
- thin server actions over the existing services.

It adds no new business rules. Pages build only from the shared components (CLAUDE.md
conventions, enforced by `tests/ui/no-raw-styles.test.ts`). It adds no dependencies. The one new
UI primitive, `textarea`, comes from the shadcn CLI, which we already use.

## Decisions

| # | Decision |
|---|---|
| 1 | **Confirmation inputs live inside `ConfirmDialog`.** Void (reason), refund (amount + reason), and reject freeze (optional reason) collect their inputs in the dialog. `ConfirmDialog` gets two optional props. `fields: (formId) => ReactNode` holds controls rendered in the dialog body and tied to the dialog's form through the HTML `form` attribute, so `requestSubmit()` sends them even though the dialog is a portal. `validate: (form) => boolean`: when `fields` is set, it runs on confirm, and a failure keeps the dialog open (it calls `showFieldErrors`, which focuses the first invalid field inside the dialog). Without `fields` it runs before the dialog opens, which the record-payment switch needs for its page form. |
| 2 | **Row-action results sit at page level.** A new shared client component `ActionResults` (provider + results region + `useActionResults()`) generalizes the trainers page pattern. Row actions run through it, and its always-mounted `FormAlert` is the `finalFocus` target. A results region inside a card would lose its state, because cards move or unmount after an action: leaving moves a membership from Current to Past, and revoking removes the row. Forms with fields (invite, freeze request, record payment, extend) keep their own `useActionState` and an inline `FormAlert`, because they stay mounted. |
| 3 | **The switch confirmation is driven by the read model.** `getMemberDetail().recordPayment.plans[].replacement` and `openBase` already say what recording each plan does. When the admin picks a `switch` plan, the submit button becomes a `ConfirmDialog` ("X days left will be lost", "the partner will be removed"). `confirmSwitch=true` is sent only by the dialog's confirm, never pre-set in the form (see step 13). `same_plan`, `conflict`, and `closedForToday` disable submit and explain why. If the page is stale, the server still answers `HAS_ACTIVE_BASE` with `SWITCH_NEEDS_CONFIRMATION`. The action shows that reason with the fresh day count, and `refresh()` updates the form. |
| 4 | **Error copy lives in one tested module**, `src/lib/memberships-ui/messages.ts`. Every `MembershipErrorCode` maps through a complete typed `Record` per audience (`member`, `admin`), so a new code fails `tsc`. `HAS_ACTIVE_BASE` details are parsed with a Zod schema of `OpenBaseConflictDetails` and mapped per reason. `INVALID_FREEZE_DATES` reasons map to field errors. `RATE_LIMITED` gets a generic "Too many attempts" message that never reveals account state. |
| 5 | **Client and server share the form schemas** (`src/lib/memberships-ui/forms.ts`), built on the client-safe schemas in `services/memberships/schemas.ts` (`reasonSchema`, `noteSchema`, `referenceSchema`, `manualPaymentMethodSchema`, `localDateSchema`). Client forms run them before submitting (`showFieldErrors`). Server actions parse FormData with the same schemas and return `fieldErrors` the forms render. |
| 6 | **Money:** `src/lib/money.ts` has `formatMoney(cents, currency)` (`Intl.NumberFormat`, en-GB) and `parseAmountToCents("12.50")` (strict decimal, at most 2 places, returns integer cents). The refund amount field takes currency units. The default is the full amount when a full refund is allowed; otherwise the hint says "less than {amount}" (decision 8: a full refund only on the latest payment). |
| 7 | **The member page is a single column of stacked cards** (`PageContainer width="narrow"`). `DataTable` switches to card mode below a 42rem container, so the payment and past-membership lists are always cards on this page. No horizontal scroll at 320 px: long values wrap (`wrap-anywhere`), and button groups wrap with `flex-wrap`. |
| 8 | **Nav:** `MAIN_NAV` gets "Membership" (`/account/membership`) for every signed-in user. `NavItem` gets `exact?: boolean` and the account link uses it, so `/account/membership` doesn't highlight both. `ADMIN_NAV` becomes Members, Memberships, Payments, Users, Trainers. |
| 9 | **Server actions** (`"use server"`, one file per area): get the actor with `requireUser`/`requireRole("ADMIN")` (an `AuthError` becomes a message), parse FormData with Zod, call the service with `ipHash` from `getRequestIpHash()` (trials also pass the raw IP from a new `getRequestIp()`, decision 11), map `MembershipError` through decision 4, call `refresh()` on success, and return `ActionResult = { status, message?, fieldErrors? }`. Invite create and resend send the email after commit with `sendMembershipInvite`. A failed delivery returns "created, but the email could not be sent; use Resend", as the trainers page does. |
| 10 | **How the admin pages are guarded.** `src/proxy.ts` only redirects signed-out visitors (cookie presence) and is never an authorization decision. `src/app/admin/layout.tsx` renders the sidebar only and checks nothing. The guards are, in order: (1) each admin page's data component first calls `requirePageUser(returnTo, "ADMIN")`, which redirects signed-out visitors to sign-in and calls `notFound()` for any other role; (2) every read model it then calls (`listMembers`, `getMemberDetail`, `listMemberships`, `listPendingFreezes`, `getMembershipDetail`, `listPayments`) calls `requireRole("ADMIN")` itself; (3) every admin action calls `requireRole("ADMIN")`; (4) every admin service re-checks the actor inside its transaction (`requireActiveAdmin`). To test (1), `requirePageUser` moves from `session.ts` into `createGuards` in `src/lib/auth/guards.ts`, with the same behaviour, and `session.ts` re-exports it. The existing session mock (`createGuards(async () => session.user)`) then gives tests the real page guard. Each page's data component lives in a sibling file (e.g. `members-list.tsx`), because `page.tsx` may only export what Next allows. |
| 11 | **Raw IP use.** `getRequestIp()` returns the first `x-forwarded-for` address. Its only caller is `startTrialAction`, which passes it to `startTrial`. There it serves only as the `trialStartIp` rate-limit identifier, and the limiter hashes it before it reaches Redis. The raw IP is never stored in the database, never written to audit rows (those keep `keyedHash("ip", …)` via `getRequestIpHash()`), and never logged. The helper's doc comment says so, and so does CLAUDE.md. |

## Shared additions (no page code)

- `src/components/status-badge.tsx`: `FreezeStatusBadge` and `PaymentStatusBadge`, each with a
  typed `Record<Enum, StatusDisplay>`.
  - Freeze: REQUESTED → pending "Requested", APPROVED → frozen "Approved", COMPLETED → expired
    "Completed", REJECTED → past-due "Rejected", CANCELLED → cancelled "Cancelled".
  - Payment: SUCCEEDED → active "Paid", PARTIALLY_REFUNDED → pending "Partly refunded",
    REFUNDED → expired "Refunded", VOIDED → cancelled "Voided", PENDING → pending "Pending",
    FAILED → past-due "Failed", DISPUTED → past-due "Disputed".
- `src/components/confirm-dialog.tsx`: `fields` and `validate` (decision 1). The open and
  confirm decisions move into two small exported functions so they can be unit tested without
  a DOM: `shouldOpen({ hasFields, validate, form })` and `confirmSubmit({ hasFields, validate,
  form })` → `"submitted" | "invalid"`. On `"invalid"` it doesn't call `form.requestSubmit()`
  and the dialog stays open. The tests use a stub form object (`requestSubmit: vi.fn()`). Field
  values reaching the action are checked by hand (see Verification). No test dependencies are
  added.
- `src/components/action-results.tsx` (client): `ActionResultsProvider`, `ActionResults`, and
  `useActionResults()`, whose `run({ key, pendingMessage, action, formData })` returns
  `{ pendingKey, resultsRef }`. Built on `useActionState` + `useOptimistic`, like
  `InviteActionsProvider`. A pure `describeActionResult(result, pending)` is unit tested.
- `src/components/detail-list.tsx`: `DetailList({ items: { term, value }[] })`, a responsive
  `dl` grid (the `/account` card pattern) reused on the member page and the admin detail pages.
- `src/components/ui/textarea.tsx` via `npx shadcn@4.23.0 add textarea` (switch the `cn` import,
  adjust to tokens), plus `TextareaField` in `form-field.tsx`. Notes and reasons use it.
- `src/components/layout/nav.ts`: decision 8.
- `src/lib/money.ts` (decision 6). `src/lib/request-ip.ts`: `getRequestIp()` (decision 11),
  which `getRequestIpHash()` now uses.
- `src/lib/auth/guards.ts`: `requirePageUser` moves into `createGuards` (decision 10).
- `src/lib/memberships-ui/` (client-safe; no `server-only`):
  - `labels.ts`: typed label maps for payment method, membership source, member role, trial
    kind, and credit reason.
  - `display.ts`:
    - `periodText` ("12 Nov 2026 – 12 Dec 2026", or "Valid today until closing (21:00)" when
      `endsAtClosing`);
    - `freezeDaysText` (last day = `endsAt` minus one local day, via `addDaysZoned`);
    - `canCancelFreeze(f, now)`;
    - `correctionEffect(payment, membership)`: "cancels the membership" when
      `periodStart <= currentPeriodStart` (the service's activating-payment rule), else "end
      moves back to {periodStart}";
    - `recordPaymentNotice(plan, openBase)` → `{ tone, text, blocked, needsConfirm,
      confirmText }` for decision 3.
  - `messages.ts` (decision 4) and `forms.ts` (decision 5, plus the `ActionResult` type).
- Existing helpers reused as they are: `formatLocal`/`formatLocalTime`/`addDaysZoned`
  (`src/lib/time.ts`), `showFieldErrors` (`src/lib/forms/field-errors.ts`), `fieldErrors`
  (`src/lib/auth/schemas.ts`), `requirePageUser`/`requireUser`/`requireRole`
  (`src/lib/auth/session.ts`), and `Pagination`, `EmptyState`, `PageHeader`/`SectionHeader`,
  `DataTable`, `FormAlert`, `InlineStatus`, `SubmitButton`, `InputField`/`SelectField`, `TextLink`,
  `Card`, `Skeleton`.

## 12. Member pages

`src/app/account/membership/`:
- `page.tsx`: `PageContainer narrow`, `PageHeader "Membership"`, and `<Suspense>` (skeleton)
  around `MembershipView`. `MembershipView` calls `requirePageUser("/account/membership")` (it
  awaits `io()`) and then `Promise.all([getMyMemberships(), getMyTrialEligibility(),
  listJoinablePlans()])`, all wrapped in `ActionResultsProvider` with `ActionResults` under the
  header.
- **Current memberships**: one card per membership.
  - Plan name, `MembershipStatusBadge`, and a `DetailList` with the period (`periodText`),
    credits left (when `creditBalance !== null`), and "Shared by {owner}" for a partner.
  - Couples, owner view:
    - partners, each with Remove (`ConfirmDialog`: "{name} loses access right away. You can
      invite someone else.");
    - the pending invite (email, expiry), with Resend (row action) and Revoke (`ConfirmDialog`);
    - an invite form (email; `INVITE_OWN_EMAIL` maps to the field) when `canInvite` and no
      invite is pending.
  - Couples, partner view: Leave (`ConfirmDialog`: "You lose access to {plan} right away.
    {owner} would have to invite you again.").
  - Freezes (owner):
    - history with `FreezeStatusBadge`, first and last day, and the rejection reason;
    - Cancel (`ConfirmDialog`; for an approved freeze: "your end date moves back by {n} days")
      while `canCancelFreeze`;
    - a request form when `freezeRequest` is set: two `type="date"` fields with
      `min = earliestStart`, a hint ("whole days, 1–30, from {date}; approved by the gym before
      it starts"), client checks, and server reasons mapped to the fields.
  - Partners see approved freezes read-only.
- **Trials**: one card per eligible kind.
  - Gym Trial: a `ConfirmDialog` trigger "Start Gym Trial". Title "Start your Gym Trial now?",
    description "It's valid today until closing ({formatLocalTime(endsAt)}) and can be used
    once.", confirm "Start trial", cancel "Not now".
  - Class Trial: "1 class credit, valid 7 days (until {date})", with the same dialog pattern.
  - `CLOSED_FOR_TODAY` and `EMAIL_NOT_VERIFIED` get an explanatory line. Other ineligible
    reasons hide the card.
- **Join at the front desk**: shown when there is no current BASE membership (new member,
  ended trial). It lists `listJoinablePlans()` (name, price, description) with "Visit the front
  desk to join". When there is nothing else to show, an `EmptyState` comes first.
- **Payment history** (`DataTable`, cards on phones): paid date, plan, amount and refunded
  amount, method label, `PaymentStatusBadge`, and the covered period. No notes or references.
- **Past memberships** (`DataTable`): plan, status badge, ended date, period.
- `actions.ts`: `startTrialAction`, `requestFreezeAction`, `cancelFreezeAction`,
  `createInviteAction`, `resendInviteAction`, `revokeInviteAction`, `removePartnerAction`,
  `leaveMembershipAction`.
- `/account/page.tsx`: a membership summary card (current base plan, status, end, and a "View
  membership" link) from `getMyMemberships()`.
- `src/app/invite/membership/[token]/accept-form.tsx`: the success link goes to
  `/account/membership`.
- Tests:
  - `actions.test.ts` (real DB; mocks `next/cache` `refresh`, `@/lib/request-ip`, and the
    session via `createGuards` per CLAUDE.md): field errors for bad freeze dates, `TOO_SOON`
    mapped to `firstDay`, `TRIAL_ALREADY_USED` copy, invite `INVITE_OWN_EMAIL` on the field,
    leave and remove ending the seat, and a non-owner cancelling a freeze.
  - Markup tests for the membership card: the closing-time period, a partner sees Leave and no
    invite form, and the freeze form only when `freezeRequest` is set.

**Checkpoint (stop here).** I ask you to review `/account/membership` at 375 px and 1280 px:
- empty state;
- Gym and Class Trial (confirm dialog with the closing time, "Not now");
- after a trial (front desk plans).

For the owner, partner, and freeze views before the admin pages exist, I'll give you a throwaway
script that records a Couples Premium membership through `createManualMembership`. It lives in
`/.local/` at the repo root, so the `@/` imports resolve. `/.local/` is added to `.gitignore` in
the same commit, so the script is never committed. Run it with
`npx tsx --conditions=react-server --env-file-if-exists=.env .local/checkpoint-couples.ts`. I wait
for your OK or changes before step 13.

## 13. Admin members pages

- Nav (decision 8).
- `src/app/admin/members/page.tsx`:
  - search (the `/admin/users` pattern) + `listMembers({ q, page })`;
  - `DataTable` columns: member (a name link to the detail page, plus the email), base
    membership (plan, `MembershipStatusBadge`, "until {date}" or "partner seat", or "None"),
    joined;
  - `Pagination` that keeps `q`.
- `src/app/admin/members/[userId]/page.tsx`: `getMemberDetail(userId)`, else `notFound()`.
  - Profile `DetailList`: email, role, verified, joined, deleted account.
  - **Record payment** card (`record-payment-form.tsx`, client): plan `SelectField` (name ·
    price), method, reference, note (`TextareaField`, hint "no personal data"). A live
    `recordPaymentNotice` shows per selected plan:
    - supersede: info "Their {Gym Trial} ends now";
    - switch: warning, and submit becomes a `ConfirmDialog`: "Switch {from} to {to}? {from}
      ends now and {n} days left will be lost; paid time isn't refunded. {The partner will be
      removed.}";
    - same plan: points to Extend;
    - conflict: reason copy;
    - closed for today: Day Pass copy.

    Hidden when `recordPayment.allowed` is false.

    `confirmSwitch` is never pre-set in the page form. Only the switch dialog's confirm adds it
    (e.g. as the submitter's name/value, or set in `confirm`). An Enter-key submit without it gets
    the server's `SWITCH_NEEDS_CONFIRMATION` copy. The form also intercepts `onSubmit` and opens
    the dialog instead of submitting.
  - **Memberships** `DataTable`: plan (a link to the membership detail page), status, period,
    seat role, credits.
  - An **Extend** card per membership with `extension`: "Extend to {newEnd} for {price}", with
    method, reference, and note. Shared component `src/app/admin/memberships/extend-form.tsx`.
  - **Payments** `DataTable` (rows link to their membership) and the **trials used** list.
- `src/app/admin/members/[userId]/actions.ts`: `recordPaymentAction`. Extend lives in
  `src/app/admin/memberships/actions.ts`.
- Tests (`actions.test.ts`):
  - record payment success: the amount comes from the plan;
  - a switch without `confirmSwitch` returns the reason copy with the day count, and with it the
    switch succeeds;
  - `recordPaymentAction` without `confirmSwitch` on a switch returns the confirmation copy and
    changes nothing (no payment, the open membership untouched);
  - a note containing an email returns a field error;
  - `DUPLICATE_REFERENCE` maps to the reference field;
  - a non-admin is refused;
  - extend success, and `MEMBERSHIP_ENDED` copy.

  Unit tests for `recordPaymentNotice` cover every `replacement` action.

## 14. Admin memberships and payments pages

- `src/app/admin/memberships/page.tsx`:
  - **Pending freezes** (`listPendingFreezes`): member, plan, days (`freezeDaysText`),
    requested, current end. Actions: Approve (row action) and Reject (`ConfirmDialog` with an
    optional reason field).
  - **All memberships**: a GET filter form (status, plan, source, "expiring in 7 days"
    checkbox, Apply, and a Clear link), `DataTable` (owner link, plan link, status, source, end,
    seats), and `Pagination` that keeps the filters.
- `src/app/admin/memberships/[id]/page.tsx`: `getMembershipDetail(id)`, else `notFound()`.
  - Header: plan, owner link, and status badge. `DetailList`: source, stored status when it
    differs, period, created by and at, credit balance.
  - The Extend card.
  - **Seats**: Remove partner (`ConfirmDialog`) on open partner seats of a running membership.
  - **Invites**: `InviteStatusBadge`, accepted or revoked by ("system" when the membership
    ended), and Revoke (`ConfirmDialog`) on pending ones.
  - **Payments**: amount, refunded, method, reference, note, recorded/voided/refunded by with
    reasons. Void (`ConfirmDialog` + reason field; the description uses `correctionEffect`) when
    `canVoid`. Refund (`ConfirmDialog` + amount and reason fields; the max is the full amount
    when `canRefundFull`, otherwise less than it) when `canRefund`. A full refund rolls back or
    cancels like a void, so the refund dialog's description follows the amount field. When the
    amount equals the full payment, it adds the `correctionEffect` text (the same text void
    shows); for a partial amount it says only the amounts change. The choice is a pure
    `refundEffectText(amountCents, payment, membership)` in `display.ts`, unit tested.
  - The void, refund, and reject dialogs keep their field-error state inside the component
    rendered by `fields`, so it resets when the dialog reopens.
  - **Freezes**: Approve or Reject for undecided future requests, and Cancel (`ConfirmDialog`)
    for open ones not yet started.
  - **Credit ledger** and **audit trail** (action, actor, time, compact details JSON).
- `src/app/admin/payments/page.tsx`:
  - a GET filter form (method, status, from, to as `type="date"`);
  - a totals card per currency (gross, refunded, net, count; `formatMoney`);
  - `DataTable`: paid at, member link, plan, amount, refunded, method, reference, status,
    recorded by, membership link;
  - `Pagination` that keeps the filters.
- `src/app/admin/memberships/actions.ts`: `extendMembershipAction`, `voidPaymentAction`,
  `refundPaymentAction`, `approveFreezeAction`, `rejectFreezeAction`, `cancelFreezeAction`,
  `adminRemovePartnerAction`, `adminRevokeInviteAction`. `refundPaymentAction` parses the
  amount with `refundFormSchema(currency)` using the payment's currency looked up on the server,
  never a form field.
- `npx next typegen` after adding the routes.
- Tests (`actions.test.ts`). These build the FormData exactly as the dialog fields name their
  controls, so they cover parsing the dialog fields:
  - void needs a reason, and the stored `voidReason` equals the trimmed reason;
  - void of a non-latest payment shows the `NOT_LATEST_PAYMENT` copy;
  - refund "12.50" records 1250 cents and the reason;
  - an over-amount or malformed amount returns an `amount` field error;
  - reject with an optional reason stores it; a blank reason stores null;
  - approve and reject change the freeze, and approving after the start shows `FREEZE_STARTED`
    copy;
  - every admin action is refused for MEMBER and TRAINER, and nothing changes.
- `src/app/admin/admin-pages.test.tsx` (decision 10): for each admin data component (members
  list, member detail, memberships list, membership detail, payments), MEMBER and TRAINER get
  `notFound()` (error digest `NEXT_HTTP_ERROR_FALLBACK;404`), a signed-out visitor gets the
  sign-in redirect, and an ADMIN renders.

## 15. Finalize `CLAUDE.md` and the spec

- `CLAUDE.md` Architecture and Conventions:
  - the membership pages and where their actions live;
  - `ActionResults` (row actions, results above the list);
  - `ConfirmDialog` `fields`/`validate`;
  - `DetailList`, `TextareaField`;
  - `src/lib/money.ts`;
  - `src/lib/memberships-ui/` (labels, display, messages, forms);
  - `getRequestIp()` (raw IP only as the trial rate-limit identifier; never stored or logged);
  - `requirePageUser` now comes from `createGuards`, so the session mock covers page guards;
  - nav `exact`.
- `CLAUDE.md` Testing: the server-action test pattern (mock `next/cache` `refresh` and
  `@/lib/request-ip`).
- `docs/spec.md`: milestone 2a.3 marked done. Member and admin page wording, wherever the pages
  settled details (e.g. "join at the front desk" after a trial).

## Implementation steps (one small commit each; `/verify` before every commit)

0. `git switch -c feat/memberships-ui`.
1. `docs: add memberships UI plan`: this file as `docs/plans/memberships-ui.md`. Before any
   code, read the bundled docs: `02-guides/forms.md`, `02-guides/server-actions.md`,
   `02-guides/authentication-with-cache-components.md`, `03-api-reference/04-functions/refresh.md`,
   and `03-api-reference/04-functions/io.md` (under `node_modules/next/dist/docs/01-app/`).
2. `feat: add freeze and payment badges, detail list, textarea, and nav items`: status maps,
   `DetailList`, textarea + `TextareaField`, nav `exact` and the new nav items, with
   markup/unit tests.
3. `feat: add confirm dialog fields and action results`: `ConfirmDialog` `fields`/`validate`
   with `shouldOpen`/`confirmSubmit` unit tests (a failing `validate` keeps the dialog open and
   never submits), and `ActionResults` with `describeActionResult` tests.
4. `feat: add membership UI helpers`: `money.ts`, `getRequestIp`, the `requirePageUser` move
   into `createGuards`, and `memberships-ui/*`, with unit tests (every error code and conflict
   reason has copy, money parsing edge cases, freeze day text across DST, correction and refund
   effect, record-payment notice).
5. `feat: add member membership page actions` (with tests).
6. `feat: add member membership page`: page, account summary, accept link, and `/.local/` in
   `.gitignore`. **Checkpoint.**
7. `feat: add admin members pages` (list, detail, record payment, extend, actions + tests).
8. `feat: add admin memberships pages` (queue, list, detail, corrections, actions + tests).
9. `feat: add admin payments page` and `admin-pages.test.tsx`.
10. `docs: document membership pages and mark milestone 2a.3 done` (`CLAUDE.md`, spec).

## Verification

- `/verify` (tsc, lint, tests) and `npm run build`. The build catches missing Suspense boundaries
  under `cacheComponents`.
- Manual run (`docker compose up -d`, `npm run db:deploy`, `npm run db:seed`, `npm run dev`;
  admin via `npm run auth:create-admin`; members sign up through Mailpit at
  http://localhost:8025), at 375 px and 1280 px:
  1. As the admin, record Basic for member A, extend it (the card shows the new end and price),
     and void the extension. The confirm dialog names the rollback, and the period end returns
     to the previous end.
  2. Record Couples Premium for a fresh member B. B invites member C from
     `/account/membership`, the email arrives in Mailpit, C accepts and sees "Shared by B", B
     removes C (confirm), and C's page moves the membership to Past.
  3. B requests a freeze (the earliest date is the day after tomorrow), the admin approves it in
     the Memberships queue, and B's period end moves by the freeze length. Cancel one approved
     freeze and check the end moves back.
  4. Fresh account D starts the Gym Trial (the dialog shows "valid today until closing (HH:MM)";
     check "Not now" first) and the Class Trial. A second attempt is refused with clear copy. The
     admin records Basic for D, and the notice says the Gym Trial ends now. Recording Premium
     then asks for confirmation with "X days left will be lost".
  5. Refund: a partial refund on an older payment (the amount must be less than the full
     amount; the dialog says only amounts change), then a full refund on the latest one (the
     dialog shows the rollback or cancellation text, as void does).
  6. Dialog field values arrive: after void, the payment row shows the reason typed in the
     dialog; after refund, the refunded amount and reason; after reject, the member sees the
     rejection reason. An empty void reason keeps the dialog open with the error on the field.
  7. Payments page: filters and totals match (voided excluded).
  8. As a MEMBER and as a TRAINER, `/admin/members`, `/admin/memberships`, and `/admin/payments`
     return 404; signed out, they redirect to sign-in.
  9. `audit_logs` (`npm run db:studio`): every action above has a row, with no emails, notes,
     references, or reasons in `details`.
- Keyboard: each confirm dialog traps focus. With an invalid dialog field, the dialog stays open
  and focuses the field. After a row action that removes its trigger, focus lands on the results
  region. No horizontal scroll at 320 px on `/account/membership`.

## Not in this PR

Stripe; an admin ending memberships early (other than a switch); ending a started freeze; freeze
decision emails; admin-created walk-in accounts; credit adjustments; refactoring the trainers
page onto `ActionResults`.

**Membership usage limits** (one follow-up PR after this one; recorded in `docs/spec.md` as
Planned, not implemented here):
- **Partner cooldown:** after a Couples partner seat ends (removed or left), a new partner can
  join only after `PARTNER_CHANGE_COOLDOWN_DAYS = 15` days (a fixed constant, not per plan
  length). The invite form shows the date. Admins can still remove partners at any time. Only
  the membership waits, not the person who left.
- **Freeze cap:** at most `MAX_FREEZE_DAYS_PER_YEAR = 60` freeze days per membership over the
  last 12 months. Approved and completed freezes count; cancelled, rejected, and lapsed ones
  don't. Each freeze is still 1–30 days. The freeze form shows the days left.
