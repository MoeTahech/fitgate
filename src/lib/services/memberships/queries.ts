import "server-only";
import { z } from "zod";
import type {
  CreditReason,
  FreezeStatus,
  InviteStatus,
  MemberRole,
  MembershipSource,
  MembershipStatus,
  PaymentMethod,
  PaymentStatus,
  Prisma,
  TrialKind,
} from "@/generated/prisma/client";
import type { AppRole } from "@/lib/auth/constants";
import { requireRole, requireUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { userListQuery } from "@/lib/services/users";
import { addDaysZoned, startOfZonedDay, zonedParts } from "@/lib/time";
import { correctionOptions, LATEST_VALID_PAYMENT_ORDER, type CorrectionOptions } from "./corrections";
import { FREEZE_LEAD_DAYS } from "./freezes";
import { getGymClock, VALID_PAYMENT_STATUSES } from "./internal";
import {
  computePeriod,
  effectiveStatus,
  freezeDisplayStatus,
  isCalendarDayPlan,
  isEnded,
  isOverdue,
  isUsableAt,
  openBaseReplacement,
  remainingUsableDays,
  type FreezeWindow,
  type GymClock,
  type MembershipState,
  type OpenBaseReplacement,
} from "./rules";
import { userIdSchema } from "./schemas";
import { trialEligibility, type TrialEligibility } from "./trials";

export const LIST_PAGE_SIZE = 25;
const MEMBER_PAYMENTS_LIMIT = 200;
const PENDING_FREEZES_LIMIT = 100;
const AUDIT_TRAIL_LIMIT = 200;
const EXPIRING_WINDOW_MS = 7 * 86_400_000;

export const MEMBERSHIP_STATUSES = ["ACTIVE", "PAST_DUE", "FROZEN", "CANCELLED", "EXPIRED"] as const satisfies readonly MembershipStatus[];
export const MEMBERSHIP_SOURCES = ["MANUAL", "TRIAL", "STRIPE"] as const satisfies readonly MembershipSource[];
export const PAYMENT_METHODS = ["CASH", "WHISH", "OMT", "BANK_TRANSFER", "OTHER", "STRIPE"] as const satisfies readonly PaymentMethod[];
export const PAYMENT_STATUSES = [
  "SUCCEEDED",
  "PARTIALLY_REFUNDED",
  "REFUNDED",
  "VOIDED",
  "PENDING",
  "FAILED",
  "DISPUTED",
] as const satisfies readonly PaymentStatus[];

const ENDED_STATUSES: MembershipStatus[] = ["CANCELLED", "EXPIRED"];
const FREEZES_IN_EFFECT: FreezeStatus[] = ["APPROVED", "COMPLETED"];
/** Payments that never collected money stay out of the totals. */
const UNCOLLECTED_PAYMENT_STATUSES: PaymentStatus[] = ["VOIDED", "PENDING", "FAILED"];

const pageSchema = z.coerce.number().int().min(1).max(10_000).catch(1).default(1);

function pageCount(total: number): number {
  return Math.max(1, Math.ceil(total / LIST_PAGE_SIZE));
}

// ─── Shared shapes ───────────────────────────────────────────────────────────

const planSummarySelect = {
  id: true,
  name: true,
  type: true,
  billing: true,
  openAccess: true,
  classAccess: true,
  credits: true,
  intervalMonths: true,
  durationDays: true,
  durationMode: true,
  maxMembers: true,
  trialKind: true,
  priceCents: true,
  currency: true,
} satisfies Prisma.PlanSelect;

export type PlanSummary = Prisma.PlanGetPayload<{ select: typeof planSummarySelect }>;

const freezeWindowSelect = { status: true, startsAt: true, endsAt: true } satisfies Prisma.MembershipFreezeSelect;

/** The membership fields the rules need, with the freezes that take time out of it. */
const membershipStateSelect = {
  id: true,
  ownerId: true,
  source: true,
  status: true,
  startsAt: true,
  currentPeriodStart: true,
  currentPeriodEnd: true,
  pastDueSince: true,
  cancelAtPeriodEnd: true,
  endedAt: true,
  plan: { select: planSummarySelect },
  freezes: { where: { status: { in: FREEZES_IN_EFFECT } }, select: freezeWindowSelect },
} satisfies Prisma.MembershipSelect;

type StatefulMembership = MembershipState & { endedAt: Date | null; plan: PlanSummary };

/** How a membership stands at `now`, worked out from its stored dates and freezes. */
export type MembershipStanding = {
  /** The display status: overdue memberships show as ended, frozen ones inside a freeze window. */
  status: MembershipStatus;
  usable: boolean;
  /** The stored end, or the period end of an overdue membership that nothing has marked ended yet. */
  endedAt: Date | null;
  /** Ends at the start day's closing time ("valid today until closing"). */
  endsAtClosing: boolean;
};

function standing(m: StatefulMembership, freezes: readonly FreezeWindow[], now: Date): MembershipStanding {
  return {
    status: effectiveStatus(m, freezes, now),
    usable: isUsableAt(m, freezes, now),
    endedAt: m.endedAt ?? (isOverdue(m, now) ? m.currentPeriodEnd : null),
    endsAtClosing: isCalendarDayPlan(m.plan),
  };
}

function isRunning(m: StatefulMembership, now: Date): boolean {
  return !isEnded(m) && !isOverdue(m, now);
}

/** Credit balances (sum of ledger deltas) of the memberships on credit plans; null for the others. */
async function creditBalances(memberships: readonly { id: string; plan: Pick<PlanSummary, "classAccess"> }[]) {
  const ids = memberships.filter((m) => m.plan.classAccess === "CREDITS").map((m) => m.id);
  const sums =
    ids.length === 0
      ? []
      : await db.creditLedger.groupBy({ by: ["membershipId"], where: { membershipId: { in: ids } }, _sum: { delta: true } });
  const byId = new Map(sums.map((row) => [row.membershipId, row._sum.delta ?? 0]));
  return (membershipId: string): number | null => (ids.includes(membershipId) ? (byId.get(membershipId) ?? 0) : null);
}

export type ExtensionPreview = { priceCents: number; currency: string; newEnd: Date };

/** What `extendManualMembership` would charge and the end it would set, or null when it can't extend. */
function extensionPreview(m: StatefulMembership, clock: GymClock, now: Date): ExtensionPreview | null {
  if (m.source !== "MANUAL" || m.plan.billing !== "RECURRING" || !isRunning(m, now)) return null;
  const period = computePeriod(m.plan, m.currentPeriodEnd, clock);
  return period ? { priceCents: m.plan.priceCents, currency: m.plan.currency, newEnd: period.end } : null;
}

// ─── Effective-status filters (SQL twins of the rules) ───────────────────────

function autoRenewingWhere(): Prisma.MembershipWhereInput {
  return { source: "STRIPE", cancelAtPeriodEnd: false, plan: { billing: "RECURRING" } };
}

/** `isOverdue`: not ended, not auto-renewing, and the period is over. */
function overdueWhere(now: Date): Prisma.MembershipWhereInput {
  return { status: { notIn: ENDED_STATUSES }, currentPeriodEnd: { lte: now }, NOT: autoRenewingWhere() };
}

/** Neither ended nor overdue. */
function runningWhere(now: Date): Prisma.MembershipWhereInput {
  return { status: { notIn: ENDED_STATUSES }, OR: [{ currentPeriodEnd: { gt: now } }, autoRenewingWhere()] };
}

function freezeCoversWhere(now: Date): Prisma.MembershipFreezeWhereInput {
  return { status: { in: FREEZES_IN_EFFECT }, startsAt: { lte: now }, endsAt: { gt: now } };
}

/** Matches the memberships whose `effectiveStatus` at `now` is `status`. */
function effectiveStatusWhere(status: MembershipStatus, now: Date): Prisma.MembershipWhereInput {
  switch (status) {
    case "CANCELLED":
    case "EXPIRED":
      return { OR: [{ status }, { AND: [overdueWhere(now), { cancelAtPeriodEnd: status === "CANCELLED" }] }] };
    case "FROZEN":
      return { AND: [runningWhere(now), { OR: [{ status: "FROZEN" }, { freezes: { some: freezeCoversWhere(now) } }] }] };
    case "ACTIVE":
    case "PAST_DUE":
      return { AND: [runningWhere(now), { status }, { freezes: { none: freezeCoversWhere(now) } }] };
  }
}

/** Running, not auto-renewing, and ending within 7 days. */
function expiringWhere(now: Date): Prisma.MembershipWhereInput {
  return {
    AND: [runningWhere(now), { NOT: autoRenewingWhere() }, { currentPeriodEnd: { lte: new Date(now.getTime() + EXPIRING_WINDOW_MS) } }],
  };
}

// ─── Member: own memberships ─────────────────────────────────────────────────

export type MyFreeze = { id: string; status: FreezeStatus; startsAt: Date; endsAt: Date; reason: string | null };

export type MyMembership = MembershipStanding & {
  id: string;
  plan: PlanSummary;
  source: MembershipSource;
  startsAt: Date;
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
  cancelAtPeriodEnd: boolean;
  creditBalance: number | null;
  /** The viewer's seat. */
  seat: { role: MemberRole; joinedAt: Date; endedAt: Date | null };
  ownerName: string;
  /** Owner only: the open partner seats. */
  partners: { seatId: string; name: string; joinedAt: Date }[];
  /** Owner only: the pending invite that hasn't expired. */
  pendingInvite: { id: string; email: string; createdAt: Date; expiresAt: Date } | null;
  /** All freezes for the owner; for a partner only the approved ones, which affect their access. */
  freezes: MyFreeze[];
  /** Owner only: set when a freeze can be requested, with the earliest start allowed. */
  freezeRequest: { earliestStart: Date } | null;
  /** Owner only: a partner can be invited (running, usable, shared plan, free seat). */
  canInvite: boolean;
};

export type MyPayment = {
  id: string;
  membershipId: string | null;
  planName: string | null;
  method: PaymentMethod;
  status: PaymentStatus;
  amountCents: number;
  amountRefundedCents: number;
  currency: string;
  periodStart: Date | null;
  periodEnd: Date | null;
  paidAt: Date | null;
};

export type MyMembershipsView = {
  timeZone: string;
  /** Running memberships the viewer holds an open seat on. */
  current: MyMembership[];
  /** Ended memberships, and those the viewer's seat on has ended. */
  past: MyMembership[];
  /** Payments the viewer made (never a partner's view of the owner's payments). No notes or references. */
  payments: MyPayment[];
};

/** The earliest freeze start allowed now: the start of the day after tomorrow, local time. */
function earliestFreezeStart(now: Date, timeZone: string): Date {
  return startOfZonedDay(zonedParts(addDaysZoned(now, FREEZE_LEAD_DAYS, timeZone), timeZone), timeZone);
}

function isOpenFreeze(f: FreezeWindow, now: Date): boolean {
  const status = freezeDisplayStatus(f, now);
  return status === "REQUESTED" || status === "APPROVED";
}

/**
 * The signed-in person's memberships: only those they hold or held a seat on. Owners see their
 * partner, pending invite, freezes, and payments; partners see the owner's name and the approved
 * freezes, never the owner's payments or invites.
 */
export async function getMyMemberships(): Promise<MyMembershipsView> {
  const user = await requireUser();
  const now = new Date();

  const [seats, payments, clock] = await Promise.all([
    db.membershipMember.findMany({
      where: { userId: user.id },
      orderBy: [{ joinedAt: "desc" }, { id: "desc" }],
      select: {
        role: true,
        joinedAt: true,
        endedAt: true,
        membership: {
          select: {
            ...membershipStateSelect,
            owner: { select: { name: true } },
            freezes: {
              orderBy: [{ startsAt: "desc" }, { id: "desc" }],
              select: { id: true, reason: true, ...freezeWindowSelect },
            },
            members: {
              where: { role: "PARTNER", endedAt: null },
              orderBy: [{ joinedAt: "asc" }, { id: "asc" }],
              select: { id: true, joinedAt: true, user: { select: { name: true } } },
            },
            invites: {
              where: { status: "PENDING", expiresAt: { gt: now } },
              orderBy: [{ createdAt: "desc" }, { id: "desc" }],
              take: 1,
              select: { id: true, email: true, createdAt: true, expiresAt: true },
            },
            _count: { select: { members: { where: { endedAt: null } } } },
          },
        },
      },
    }),
    db.payment.findMany({
      where: { userId: user.id },
      orderBy: [{ paidAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }, { id: "desc" }],
      take: MEMBER_PAYMENTS_LIMIT,
      select: {
        id: true,
        membershipId: true,
        method: true,
        status: true,
        amountCents: true,
        amountRefundedCents: true,
        currency: true,
        periodStart: true,
        periodEnd: true,
        paidAt: true,
        membership: { select: { plan: { select: { name: true } } } },
      },
    }),
    getGymClock(db),
  ]);

  // A partner who left and rejoined has several seats on one membership; the newest one counts.
  const latestSeats = seats.filter((seat, index) => seats.findIndex((s) => s.membership.id === seat.membership.id) === index);
  const balanceOf = await creditBalances(latestSeats.map((seat) => seat.membership));

  const current: MyMembership[] = [];
  const past: MyMembership[] = [];
  for (const seat of latestSeats) {
    const m = seat.membership;
    const isOwner = m.ownerId === user.id;
    const seatOpen = seat.endedAt === null;
    const state = standing(m, m.freezes, now);
    const running = isRunning(m, now);

    const earliestStart = earliestFreezeStart(now, clock.timeZone);
    const freezable =
      isOwner &&
      seatOpen &&
      running &&
      m.source === "MANUAL" &&
      m.status === "ACTIVE" &&
      m.plan.type === "BASE" &&
      m.plan.billing === "RECURRING" &&
      earliestStart.getTime() < m.currentPeriodEnd.getTime() &&
      !m.freezes.some((f) => isOpenFreeze(f, now));

    const view: MyMembership = {
      id: m.id,
      plan: m.plan,
      source: m.source,
      ...state,
      startsAt: m.startsAt,
      currentPeriodStart: m.currentPeriodStart,
      currentPeriodEnd: m.currentPeriodEnd,
      cancelAtPeriodEnd: m.cancelAtPeriodEnd,
      creditBalance: balanceOf(m.id),
      seat: { role: seat.role, joinedAt: seat.joinedAt, endedAt: seat.endedAt },
      ownerName: m.owner.name,
      partners: isOwner ? m.members.map((p) => ({ seatId: p.id, name: p.user.name, joinedAt: p.joinedAt })) : [],
      pendingInvite: isOwner && running ? (m.invites[0] ?? null) : null,
      freezes: m.freezes
        .filter((f) => isOwner || FREEZES_IN_EFFECT.includes(f.status))
        .map((f) => ({ id: f.id, status: freezeDisplayStatus(f, now), startsAt: f.startsAt, endsAt: f.endsAt, reason: isOwner ? f.reason : null })),
      freezeRequest: freezable ? { earliestStart } : null,
      canInvite: isOwner && seatOpen && running && state.usable && m.plan.maxMembers >= 2 && m._count.members < m.plan.maxMembers,
    };
    (seatOpen && running ? current : past).push(view);
  }

  return {
    timeZone: clock.timeZone,
    current,
    past,
    payments: payments.map(({ membership, ...payment }) => ({ ...payment, planName: membership?.plan.name ?? null })),
  };
}

/** Whether each trial kind could start for the signed-in person now (see `trialEligibility`). */
export async function getMyTrialEligibility(): Promise<Record<TrialKind, TrialEligibility>> {
  const user = await requireUser();
  return trialEligibility(user.id);
}

export type JoinablePlan = PlanSummary & { description: string | null };

/** Active plans sold at the front desk (no trials), in display order. */
export async function listJoinablePlans(): Promise<JoinablePlan[]> {
  await requireUser();
  return db.plan.findMany({
    where: { active: true, trialKind: null },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: { ...planSummarySelect, description: true },
  });
}

// ─── Admin: members ──────────────────────────────────────────────────────────

export type BaseSummary = MembershipStanding & {
  membershipId: string;
  planName: string;
  seatRole: MemberRole;
  currentPeriodEnd: Date;
};

export type MemberListItem = {
  id: string;
  name: string;
  email: string;
  role: AppRole;
  createdAt: Date;
  /** The open base seat's membership; it may show as ended when its period is over. */
  base: BaseSummary | null;
};

export async function listMembers(params: unknown): Promise<{
  members: MemberListItem[];
  total: number;
  page: number;
  pageCount: number;
  query: string;
  timeZone: string;
}> {
  await requireRole("ADMIN");
  const { q, page } = userListQuery.parse(params ?? {});
  const query = q ?? "";
  const now = new Date();

  const where: Prisma.UserWhereInput = {
    anonymizedAt: null,
    ...(query
      ? { OR: [{ name: { contains: query, mode: "insensitive" } }, { email: { contains: query.toLowerCase() } }] }
      : {}),
  };

  const [users, total, clock] = await Promise.all([
    db.user.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      skip: (page - 1) * LIST_PAGE_SIZE,
      take: LIST_PAGE_SIZE,
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        createdAt: true,
        membershipSeats: {
          where: { planType: "BASE", endedAt: null },
          take: 1,
          select: { role: true, membership: { select: membershipStateSelect } },
        },
      },
    }),
    db.user.count({ where }),
    getGymClock(db),
  ]);

  const members = users.map(({ membershipSeats, ...user }): MemberListItem => {
    const seat = membershipSeats[0];
    if (!seat) return { ...user, base: null };
    const m = seat.membership;
    return {
      ...user,
      base: {
        membershipId: m.id,
        planName: m.plan.name,
        seatRole: seat.role,
        currentPeriodEnd: m.currentPeriodEnd,
        ...standing(m, m.freezes, now),
      },
    };
  });

  return { members, total, page, pageCount: pageCount(total), query, timeZone: clock.timeZone };
}

export type AdminMembershipSummary = MembershipStanding & {
  id: string;
  plan: PlanSummary;
  source: MembershipSource;
  startsAt: Date;
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
  owner: { id: string; name: string };
  /** The member's seat on it. */
  seat: { role: MemberRole; joinedAt: Date; endedAt: Date | null };
  creditBalance: number | null;
  extension: ExtensionPreview | null;
};

export type AdminPaymentListItem = {
  id: string;
  membershipId: string | null;
  planName: string | null;
  member: { id: string; name: string };
  method: PaymentMethod;
  status: PaymentStatus;
  amountCents: number;
  amountRefundedCents: number;
  currency: string;
  periodStart: Date | null;
  periodEnd: Date | null;
  paidAt: Date | null;
  reference: string | null;
  recordedByName: string | null;
  createdAt: Date;
};

const adminPaymentListSelect = {
  id: true,
  membershipId: true,
  method: true,
  status: true,
  amountCents: true,
  amountRefundedCents: true,
  currency: true,
  periodStart: true,
  periodEnd: true,
  paidAt: true,
  reference: true,
  createdAt: true,
  user: { select: { id: true, name: true } },
  recordedBy: { select: { name: true } },
  membership: { select: { plan: { select: { name: true } } } },
} satisfies Prisma.PaymentSelect;

function toAdminPaymentListItem(row: Prisma.PaymentGetPayload<{ select: typeof adminPaymentListSelect }>): AdminPaymentListItem {
  const { user, recordedBy, membership, ...payment } = row;
  return { ...payment, member: user, planName: membership?.plan.name ?? null, recordedByName: recordedBy?.name ?? null };
}

const PAYMENT_LIST_ORDER = [
  { paidAt: { sort: "desc", nulls: "last" } },
  { createdAt: "desc" },
  { id: "desc" },
] as const satisfies Prisma.PaymentOrderByWithRelationInput[];

/** The member's running open base, what a switch would give up, and its partner. */
export type OpenBaseView = {
  membershipId: string;
  planName: string;
  seatRole: MemberRole;
  remainingDays: number;
  hasPartner: boolean;
};

export type RecordablePlan = PlanSummary & {
  /** What recording this plan does to the open base (decision 13). */
  replacement: OpenBaseReplacement;
  /** A calendar-day plan (Day Pass) after today's closing time or on a closed day. */
  closedForToday: boolean;
};

export type MemberDetail = {
  timeZone: string;
  member: { id: string; name: string; email: string; role: AppRole; emailVerified: boolean; createdAt: Date; anonymized: boolean };
  /** Every membership the member holds or held a seat on; running ones first. */
  memberships: AdminMembershipSummary[];
  payments: AdminPaymentListItem[];
  trialsUsed: { kind: TrialKind; membershipId: string; redeemedAt: Date }[];
  recordPayment: { allowed: boolean; openBase: OpenBaseView | null; plans: RecordablePlan[] };
};

/** An admin's view of one person: profile, memberships, payments, trials used, and the record-payment options. */
export async function getMemberDetail(userId: string): Promise<MemberDetail | null> {
  await requireRole("ADMIN");
  const parsed = userIdSchema.safeParse(userId);
  if (!parsed.success) return null;
  const id = parsed.data;
  const now = new Date();

  const user = await db.user.findUnique({
    where: { id },
    select: { id: true, name: true, email: true, role: true, emailVerified: true, createdAt: true, anonymizedAt: true },
  });
  if (!user) return null;

  const [seats, payments, redemptions, plans, clock] = await Promise.all([
    db.membershipMember.findMany({
      where: { userId: id },
      orderBy: [{ joinedAt: "desc" }, { id: "desc" }],
      select: {
        role: true,
        planType: true,
        joinedAt: true,
        endedAt: true,
        membership: {
          select: {
            ...membershipStateSelect,
            owner: { select: { id: true, name: true } },
            _count: { select: { members: { where: { role: "PARTNER", endedAt: null } } } },
          },
        },
      },
    }),
    db.payment.findMany({
      where: { userId: id },
      orderBy: [...PAYMENT_LIST_ORDER],
      take: MEMBER_PAYMENTS_LIMIT,
      select: adminPaymentListSelect,
    }),
    db.trialRedemption.findMany({
      where: { userId: id },
      orderBy: { createdAt: "asc" },
      select: { kind: true, membershipId: true, createdAt: true },
    }),
    db.plan.findMany({
      where: { active: true, trialKind: null },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: planSummarySelect,
    }),
    getGymClock(db),
  ]);

  const latestSeats = seats.filter((seat, index) => seats.findIndex((s) => s.membership.id === seat.membership.id) === index);
  const balanceOf = await creditBalances(latestSeats.map((seat) => seat.membership));

  const memberships = latestSeats
    .map(({ membership: m, ...seat }) => ({
      running: seat.endedAt === null && isRunning(m, now),
      summary: {
        id: m.id,
        plan: m.plan,
        source: m.source,
        ...standing(m, m.freezes, now),
        startsAt: m.startsAt,
        currentPeriodStart: m.currentPeriodStart,
        currentPeriodEnd: m.currentPeriodEnd,
        owner: m.owner,
        seat: { role: seat.role, joinedAt: seat.joinedAt, endedAt: seat.endedAt },
        creditBalance: balanceOf(m.id),
        extension: extensionPreview(m, clock, now),
      } satisfies AdminMembershipSummary,
    }))
    .sort((a, b) => Number(b.running) - Number(a.running))
    .map(({ summary }) => summary);

  // Overdue cleanup runs before a payment is recorded, so an open base whose period is over doesn't count.
  const baseSeat = latestSeats.find(
    (seat) => seat.planType === "BASE" && seat.endedAt === null && isRunning(seat.membership, now),
  );
  const openBase: OpenBaseView | null = baseSeat
    ? {
        membershipId: baseSeat.membership.id,
        planName: baseSeat.membership.plan.name,
        seatRole: baseSeat.role,
        remainingDays: remainingUsableDays(baseSeat.membership, baseSeat.membership.freezes, now),
        hasPartner: baseSeat.membership._count.members > 0,
      }
    : null;
  const openBaseSnapshot = baseSeat
    ? {
        seatRole: baseSeat.role,
        source: baseSeat.membership.source,
        planId: baseSeat.membership.plan.id,
        plan: baseSeat.membership.plan,
      }
    : null;

  return {
    timeZone: clock.timeZone,
    member: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      emailVerified: user.emailVerified,
      createdAt: user.createdAt,
      anonymized: user.anonymizedAt !== null,
    },
    memberships,
    payments: payments.map(toAdminPaymentListItem),
    trialsUsed: redemptions.map((r) => ({ kind: r.kind, membershipId: r.membershipId, redeemedAt: r.createdAt })),
    recordPayment: {
      allowed: user.anonymizedAt === null,
      openBase,
      plans: plans.map((plan) => ({
        ...plan,
        replacement: openBaseReplacement(openBaseSnapshot, plan),
        closedForToday: isCalendarDayPlan(plan) && computePeriod(plan, now, clock) === null,
      })),
    },
  };
}

// ─── Admin: memberships ──────────────────────────────────────────────────────

const membershipListQuery = z.object({
  status: z.enum(MEMBERSHIP_STATUSES).optional().catch(undefined),
  planId: z.uuid().optional().catch(undefined),
  source: z.enum(MEMBERSHIP_SOURCES).optional().catch(undefined),
  expiring: z.stringbool().optional().catch(undefined),
  page: pageSchema,
});

export type MembershipListFilters = {
  status: MembershipStatus | null;
  planId: string | null;
  source: MembershipSource | null;
  expiring: boolean;
};

export type MembershipListItem = MembershipStanding & {
  id: string;
  owner: { id: string; name: string; email: string };
  plan: { id: string; name: string; type: PlanSummary["type"] };
  source: MembershipSource;
  currentPeriodEnd: Date;
  openSeats: number;
};

/**
 * Memberships filtered by display status (as `effectiveStatus` works it out), plan, source, and
 * "expiring": running, not auto-renewing, ending within 7 days (soonest first).
 */
export async function listMemberships(params: unknown): Promise<{
  memberships: MembershipListItem[];
  total: number;
  page: number;
  pageCount: number;
  filters: MembershipListFilters;
  plans: { id: string; name: string; active: boolean }[];
  timeZone: string;
}> {
  await requireRole("ADMIN");
  const { status, planId, source, expiring, page } = membershipListQuery.parse(params ?? {});
  const now = new Date();

  const where: Prisma.MembershipWhereInput = {
    AND: [
      status ? effectiveStatusWhere(status, now) : {},
      planId ? { planId } : {},
      source ? { source } : {},
      expiring ? expiringWhere(now) : {},
    ],
  };
  const orderBy: Prisma.MembershipOrderByWithRelationInput[] = expiring
    ? [{ currentPeriodEnd: "asc" }, { id: "asc" }]
    : [{ createdAt: "desc" }, { id: "desc" }];

  const [rows, total, plans, clock] = await Promise.all([
    db.membership.findMany({
      where,
      orderBy,
      skip: (page - 1) * LIST_PAGE_SIZE,
      take: LIST_PAGE_SIZE,
      select: {
        ...membershipStateSelect,
        owner: { select: { id: true, name: true, email: true } },
        _count: { select: { members: { where: { endedAt: null } } } },
      },
    }),
    db.membership.count({ where }),
    db.plan.findMany({ orderBy: [{ sortOrder: "asc" }, { name: "asc" }], select: { id: true, name: true, active: true } }),
    getGymClock(db),
  ]);

  return {
    memberships: rows.map((m) => ({
      id: m.id,
      owner: m.owner,
      plan: { id: m.plan.id, name: m.plan.name, type: m.plan.type },
      source: m.source,
      currentPeriodEnd: m.currentPeriodEnd,
      openSeats: m._count.members,
      ...standing(m, m.freezes, now),
    })),
    total,
    page,
    pageCount: pageCount(total),
    filters: { status: status ?? null, planId: planId ?? null, source: source ?? null, expiring: expiring ?? false },
    plans,
    timeZone: clock.timeZone,
  };
}

export type PendingFreeze = {
  id: string;
  membershipId: string;
  owner: { id: string; name: string };
  planName: string;
  startsAt: Date;
  endsAt: Date;
  requestedAt: Date;
  currentPeriodEnd: Date;
};

/**
 * The freeze requests an admin can still decide: REQUESTED, not started (a request whose start
 * has passed has lapsed), on a running membership. Soonest start first.
 */
export async function listPendingFreezes(): Promise<{ freezes: PendingFreeze[]; timeZone: string }> {
  await requireRole("ADMIN");
  const now = new Date();

  const [rows, clock] = await Promise.all([
    db.membershipFreeze.findMany({
      where: { status: "REQUESTED", startsAt: { gt: now }, membership: runningWhere(now) },
      orderBy: [{ startsAt: "asc" }, { id: "asc" }],
      take: PENDING_FREEZES_LIMIT,
      select: {
        id: true,
        membershipId: true,
        startsAt: true,
        endsAt: true,
        createdAt: true,
        membership: {
          select: { currentPeriodEnd: true, owner: { select: { id: true, name: true } }, plan: { select: { name: true } } },
        },
      },
    }),
    getGymClock(db),
  ]);

  return {
    freezes: rows.map(({ membership, createdAt, ...freeze }) => ({
      ...freeze,
      owner: membership.owner,
      planName: membership.plan.name,
      requestedAt: createdAt,
      currentPeriodEnd: membership.currentPeriodEnd,
    })),
    timeZone: clock.timeZone,
  };
}

export type MembershipDetailSeat = {
  id: string;
  user: { id: string; name: string; email: string };
  role: MemberRole;
  joinedAt: Date;
  endedAt: Date | null;
};

export type MembershipDetailInvite = {
  id: string;
  email: string;
  /** PENDING past its expiry shows as EXPIRED. */
  status: InviteStatus;
  createdAt: Date;
  expiresAt: Date;
  acceptedAt: Date | null;
  acceptedByName: string | null;
  revokedAt: Date | null;
  revokedByName: string | null;
  /** Revoked by the system when the membership ended. */
  revokedBySystem: boolean;
};

export type MembershipDetailPayment = AdminPaymentListItem & {
  note: string | null;
  voidedAt: Date | null;
  voidedByName: string | null;
  voidReason: string | null;
  refundedAt: Date | null;
  refundedByName: string | null;
  refundReason: string | null;
  corrections: CorrectionOptions;
};

export type MembershipDetailFreeze = {
  id: string;
  /** Lapsed requests show as CANCELLED, approved freezes that are over as COMPLETED. */
  status: FreezeStatus;
  startsAt: Date;
  endsAt: Date;
  requestedAt: Date;
  requestedByName: string;
  decidedAt: Date | null;
  decidedByName: string | null;
  reason: string | null;
};

export type CreditEntry = { id: string; delta: number; reason: CreditReason; createdAt: Date; actorName: string | null };

export type AuditEntryView = {
  id: string;
  action: string;
  targetType: string;
  targetId: string;
  actorName: string | null;
  details: Prisma.JsonValue;
  createdAt: Date;
};

export type MembershipDetail = {
  timeZone: string;
  membership: MembershipStanding & {
    id: string;
    plan: PlanSummary;
    source: MembershipSource;
    storedStatus: MembershipStatus;
    owner: { id: string; name: string; email: string };
    createdByName: string | null;
    startsAt: Date;
    currentPeriodStart: Date;
    currentPeriodEnd: Date;
    cancelAtPeriodEnd: boolean;
    createdAt: Date;
    extension: ExtensionPreview | null;
  };
  seats: MembershipDetailSeat[];
  invites: MembershipDetailInvite[];
  payments: MembershipDetailPayment[];
  freezes: MembershipDetailFreeze[];
  /** Null unless the plan uses credits or the ledger has entries. */
  credits: { balance: number; entries: CreditEntry[] } | null;
  /** Rows on the membership and its payments, freezes, and invites; newest first. */
  audit: AuditEntryView[];
};

/** An admin's view of one membership, with its seats, invites, payments (and allowed corrections), freezes, credits, and audit trail. */
export async function getMembershipDetail(membershipId: string): Promise<MembershipDetail | null> {
  await requireRole("ADMIN");
  const parsed = z.uuid().safeParse(membershipId);
  if (!parsed.success) return null;
  const id = parsed.data;
  const now = new Date();

  const [m, latestValid, clock] = await Promise.all([
    db.membership.findUnique({
      where: { id },
      select: {
        ...membershipStateSelect,
        createdAt: true,
        owner: { select: { id: true, name: true, email: true } },
        createdBy: { select: { name: true } },
        members: {
          orderBy: [{ joinedAt: "asc" }, { id: "asc" }],
          select: { id: true, role: true, joinedAt: true, endedAt: true, user: { select: { id: true, name: true, email: true } } },
        },
        invites: {
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          select: {
            id: true,
            email: true,
            status: true,
            createdAt: true,
            expiresAt: true,
            acceptedAt: true,
            revokedAt: true,
            revokedById: true,
            acceptedBy: { select: { name: true } },
            revokedBy: { select: { name: true } },
          },
        },
        payments: {
          orderBy: [{ periodStart: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }, { id: "desc" }],
          select: {
            ...adminPaymentListSelect,
            note: true,
            voidedAt: true,
            voidReason: true,
            refundedAt: true,
            refundReason: true,
            voidedBy: { select: { name: true } },
            refundedBy: { select: { name: true } },
          },
        },
        creditEntries: {
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          select: { id: true, delta: true, reason: true, createdAt: true, actor: { select: { name: true } } },
        },
      },
    }),
    db.payment.findFirst({
      where: { membershipId: id, status: { in: [...VALID_PAYMENT_STATUSES] } },
      orderBy: [...LATEST_VALID_PAYMENT_ORDER],
      select: { id: true },
    }),
    getGymClock(db),
  ]);
  if (!m) return null;

  const freezes = await db.membershipFreeze.findMany({
    where: { membershipId: id },
    orderBy: [{ startsAt: "desc" }, { id: "desc" }],
    select: {
      id: true,
      status: true,
      startsAt: true,
      endsAt: true,
      createdAt: true,
      decidedAt: true,
      reason: true,
      requestedBy: { select: { name: true } },
      decidedBy: { select: { name: true } },
    },
  });

  const audit = await db.auditLog.findMany({
    where: {
      OR: [
        { targetType: "membership", targetId: id },
        { targetType: "payment", targetId: { in: m.payments.map((p) => p.id) } },
        { targetType: "membership_freeze", targetId: { in: freezes.map((f) => f.id) } },
        { targetType: "membership_invite", targetId: { in: m.invites.map((i) => i.id) } },
      ],
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: AUDIT_TRAIL_LIMIT,
    select: { id: true, action: true, targetType: true, targetId: true, details: true, createdAt: true, actor: { select: { name: true } } },
  });

  const credits =
    m.plan.classAccess === "CREDITS" || m.creditEntries.length > 0
      ? {
          balance: m.creditEntries.reduce((sum, entry) => sum + entry.delta, 0),
          entries: m.creditEntries.map(({ actor, ...entry }) => ({ ...entry, actorName: actor?.name ?? null })),
        }
      : null;

  return {
    timeZone: clock.timeZone,
    membership: {
      id: m.id,
      plan: m.plan,
      source: m.source,
      storedStatus: m.status,
      ...standing(m, m.freezes, now),
      owner: m.owner,
      createdByName: m.createdBy?.name ?? null,
      startsAt: m.startsAt,
      currentPeriodStart: m.currentPeriodStart,
      currentPeriodEnd: m.currentPeriodEnd,
      cancelAtPeriodEnd: m.cancelAtPeriodEnd,
      createdAt: m.createdAt,
      extension: extensionPreview(m, clock, now),
    },
    seats: m.members.map(({ user, ...seat }) => ({ ...seat, user })),
    invites: m.invites.map(({ acceptedBy, revokedBy, revokedById, ...invite }) => ({
      ...invite,
      status: invite.status === "PENDING" && invite.expiresAt.getTime() <= now.getTime() ? "EXPIRED" : invite.status,
      acceptedByName: acceptedBy?.name ?? null,
      revokedByName: revokedBy?.name ?? null,
      revokedBySystem: invite.status === "REVOKED" && revokedById === null,
    })),
    payments: m.payments.map(({ note, voidedAt, voidReason, refundedAt, refundReason, voidedBy, refundedBy, ...row }) => ({
      ...toAdminPaymentListItem(row),
      note,
      voidedAt,
      voidedByName: voidedBy?.name ?? null,
      voidReason,
      refundedAt,
      refundedByName: refundedBy?.name ?? null,
      refundReason,
      corrections: correctionOptions(row, row.id === latestValid?.id),
    })),
    freezes: freezes.map(({ requestedBy, decidedBy, createdAt, ...freeze }) => ({
      ...freeze,
      status: freezeDisplayStatus(freeze, now),
      requestedAt: createdAt,
      requestedByName: requestedBy.name,
      decidedByName: decidedBy?.name ?? null,
    })),
    credits,
    audit: audit.map(({ actor, ...entry }) => ({ ...entry, actorName: actor?.name ?? null })),
  };
}

// ─── Admin: payments ─────────────────────────────────────────────────────────

const paymentListQuery = z.object({
  method: z.enum(PAYMENT_METHODS).optional().catch(undefined),
  status: z.enum(PAYMENT_STATUSES).optional().catch(undefined),
  from: z.iso.date().optional().catch(undefined),
  to: z.iso.date().optional().catch(undefined),
  page: pageSchema,
});

export type PaymentListFilters = {
  method: PaymentMethod | null;
  status: PaymentStatus | null;
  /** Local dates (YYYY-MM-DD, inclusive) of `paidAt` in the gym's time zone. */
  from: string | null;
  to: string | null;
};

/** Per currency: gross collected, refunded, and net; voided, pending, and failed payments excluded. */
export type PaymentTotals = { currency: string; grossCents: number; refundedCents: number; netCents: number; count: number };

function localDayStart(isoDate: string, timeZone: string, offsetDays = 0): Date {
  const [year, month, day] = isoDate.split("-").map(Number);
  return startOfZonedDay({ year, month, day: day + offsetDays }, timeZone);
}

/** Payments filtered by method, status, and local paid-date range, with totals over all matching payments. */
export async function listPayments(params: unknown): Promise<{
  payments: AdminPaymentListItem[];
  total: number;
  page: number;
  pageCount: number;
  totals: PaymentTotals[];
  filters: PaymentListFilters;
  timeZone: string;
}> {
  await requireRole("ADMIN");
  const { method, status, from, to, page } = paymentListQuery.parse(params ?? {});
  const { timeZone } = await getGymClock(db);

  const paidAt: Prisma.DateTimeNullableFilter = {
    ...(from ? { gte: localDayStart(from, timeZone) } : {}),
    ...(to ? { lt: localDayStart(to, timeZone, 1) } : {}),
  };
  const where: Prisma.PaymentWhereInput = {
    ...(method ? { method } : {}),
    ...(status ? { status } : {}),
    ...(from || to ? { paidAt } : {}),
  };

  const [rows, total, sums] = await Promise.all([
    db.payment.findMany({
      where,
      orderBy: [...PAYMENT_LIST_ORDER],
      skip: (page - 1) * LIST_PAGE_SIZE,
      take: LIST_PAGE_SIZE,
      select: adminPaymentListSelect,
    }),
    db.payment.count({ where }),
    db.payment.groupBy({
      by: ["currency"],
      where: { AND: [where, { status: { notIn: UNCOLLECTED_PAYMENT_STATUSES } }] },
      orderBy: { currency: "asc" },
      _sum: { amountCents: true, amountRefundedCents: true },
      _count: { _all: true },
    }),
  ]);

  const totals = sums.map((row): PaymentTotals => {
    const grossCents = row._sum.amountCents ?? 0;
    const refundedCents = row._sum.amountRefundedCents ?? 0;
    return { currency: row.currency, grossCents, refundedCents, netCents: grossCents - refundedCents, count: row._count._all };
  });

  return {
    payments: rows.map(toAdminPaymentListItem),
    total,
    page,
    pageCount: pageCount(total),
    totals,
    filters: { method: method ?? null, status: status ?? null, from: from ?? null, to: to ?? null },
    timeZone,
  };
}
