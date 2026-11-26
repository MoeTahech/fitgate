import { describe, expect, it } from "vitest";
import type { MyMembership, PlanSummary } from "@/lib/services/memberships/queries";
import { byAttr, byTag, find, findAll, renderMarkup, textOf } from "../../../tests/support/markup";
import { MembershipSummaryCard } from "./membership-summary";

const TZ = "Asia/Beirut";
const DAY = 86_400_000;
// Thursday 26 November 2026, 21:15 in Beirut (UTC+2).
const NOW = new Date("2026-11-26T19:15:00.000Z");

const BASE_PLAN: PlanSummary = {
  id: "plan-base",
  name: "Premium",
  type: "BASE",
  billing: "RECURRING",
  openAccess: true,
  classAccess: "UNLIMITED",
  credits: null,
  intervalMonths: 1,
  durationDays: null,
  durationMode: null,
  maxMembers: 1,
  trialKind: null,
  priceCents: 5000,
  currency: "USD",
};

const PACK_PLAN: PlanSummary = {
  ...BASE_PLAN,
  id: "plan-pack",
  name: "Class Pack",
  type: "ADDON",
  openAccess: false,
  classAccess: "CREDITS",
  credits: 10,
  intervalMonths: null,
  durationDays: 7,
  billing: "ONE_TIME",
  durationMode: "ROLLING",
};

function membership(id: string, overrides: Partial<MyMembership> = {}): MyMembership {
  return {
    id,
    plan: BASE_PLAN,
    source: "MANUAL",
    status: "ACTIVE",
    usable: true,
    endedAt: null,
    endsAtClosing: false,
    startsAt: NOW,
    currentPeriodStart: NOW,
    currentPeriodEnd: new Date(NOW.getTime() + 30 * DAY),
    cancelAtPeriodEnd: false,
    creditBalance: null,
    seat: { role: "OWNER", joinedAt: NOW, endedAt: null },
    ownerName: "Sam Owner",
    partners: [],
    pendingInvite: null,
    freezes: [],
    freezeRequest: null,
    canInvite: false,
    ...overrides,
  };
}

const render = (memberships: MyMembership[]) => renderMarkup(<MembershipSummaryCard memberships={memberships} timeZone={TZ} now={NOW} />);

describe("MembershipSummaryCard", () => {
  it("says so when there is no current membership, and still links to the membership page", () => {
    const root = render([]);
    expect(textOf(root)).toContain("You don't have a membership right now.");
    expect(find(root, byAttr("href", "/account/membership"))).toBeDefined();
  });

  it("shows every current membership, base and add-on, each with its plan and status", () => {
    const root = render([
      membership("m1"),
      membership("m2", { plan: PACK_PLAN, creditBalance: 8, currentPeriodEnd: new Date(NOW.getTime() + 7 * DAY) }),
    ]);
    expect(findAll(root, byTag("h3")).map(textOf)).toEqual(["Premium", "Class Pack"]);
    expect(findAll(root, (e) => e.tag === "span" && textOf(e) === "Active")).toHaveLength(2);
  });

  it("shows credits left only where the plan has credits", () => {
    const root = render([membership("m1"), membership("m2", { plan: PACK_PLAN, creditBalance: 8 })]);
    expect(findAll(root, byTag("dt")).map(textOf).filter((term) => term === "Credits left")).toHaveLength(1);
    expect(textOf(root)).toContain("8");
  });

  it("shows a plan's end with its time", () => {
    const root = render([membership("m2", { plan: PACK_PLAN, currentPeriodEnd: new Date("2026-12-03T19:15:00.000Z") })]);
    expect(textOf(root)).toContain("26 Nov 2026 – 3 Dec 2026, 21:15");
  });
});
