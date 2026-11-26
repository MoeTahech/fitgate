import { describe, expect, it } from "vitest";
import { ActionResultsProvider } from "@/components/action-results";
import type { MyFreeze, MyMembership, PlanSummary } from "@/lib/services/memberships/queries";
import { startOfZonedDay } from "@/lib/time";
import { byAttr, byTag, findAll, find, renderMarkup, textOf } from "../../../../tests/support/markup";
import { MembershipCard } from "./membership-card";

const TZ = "Asia/Beirut";
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
// Wednesday 2 December 2026, 10:00 in Beirut (UTC+2).
const NOW = new Date("2026-12-02T08:00:00.000Z");
const at = (offsetMs: number) => new Date(NOW.getTime() + offsetMs);

const PLAN: PlanSummary = {
  id: "plan-1",
  name: "Couples Premium",
  type: "BASE",
  billing: "RECURRING",
  openAccess: true,
  classAccess: "UNLIMITED",
  credits: null,
  intervalMonths: 1,
  durationDays: null,
  durationMode: null,
  maxMembers: 2,
  trialKind: null,
  priceCents: 8500,
  currency: "USD",
};

function membership(overrides: Partial<MyMembership> = {}): MyMembership {
  return {
    id: "0190f2a0-0000-7000-8000-000000000001",
    plan: PLAN,
    source: "MANUAL",
    status: "ACTIVE",
    usable: true,
    endedAt: null,
    endsAtClosing: false,
    startsAt: at(-5 * DAY),
    currentPeriodStart: at(-5 * DAY),
    currentPeriodEnd: at(25 * DAY),
    cancelAtPeriodEnd: false,
    creditBalance: null,
    seat: { role: "OWNER", joinedAt: at(-5 * DAY), endedAt: null },
    ownerName: "Sam Owner",
    partners: [],
    pendingInvite: null,
    freezes: [],
    freezeRequest: null,
    canInvite: false,
    ...overrides,
  };
}

function render(overrides: Partial<MyMembership> = {}) {
  return renderMarkup(
    <ActionResultsProvider>
      <MembershipCard membership={membership(overrides)} timeZone={TZ} now={NOW} />
    </ActionResultsProvider>,
  );
}

const buttonLabels = (root: ReturnType<typeof render>) => findAll(root, byTag("button")).map(textOf);
const detail = (root: ReturnType<typeof render>, term: string) => {
  const dts = findAll(root, byTag("dt"));
  const index = dts.findIndex((dt) => textOf(dt) === term);
  return index === -1 ? undefined : textOf(findAll(root, byTag("dd"))[index]);
};

const FREEZE: MyFreeze = {
  id: "0190f2a0-0000-7000-8000-0000000000f1",
  status: "APPROVED",
  startsAt: startOfZonedDay({ year: 2026, month: 12, day: 10 }, TZ),
  endsAt: startOfZonedDay({ year: 2026, month: 12, day: 17 }, TZ),
  reason: null,
};

describe("MembershipCard period", () => {
  it("shows the period as dates", () => {
    expect(detail(render(), "Period")).toBe("27 Nov 2026 – 27 Dec 2026");
  });

  it("shows a pass that ends at closing as valid today until the closing time", () => {
    const root = render({
      endsAtClosing: true,
      plan: { ...PLAN, name: "Gym Trial", maxMembers: 1 },
      currentPeriodStart: at(-HOUR),
      currentPeriodEnd: new Date("2026-12-02T19:00:00.000Z"),
    });
    expect(detail(root, "Period")).toBe("Valid today until closing (21:00)");
  });

  it("shows credits left only on a credit plan", () => {
    expect(detail(render(), "Credits left")).toBeUndefined();
    expect(detail(render({ creditBalance: 3 }), "Credits left")).toBe("3");
  });
});

describe("MembershipCard as a partner", () => {
  const partner = { seat: { role: "PARTNER" as const, joinedAt: at(-DAY), endedAt: null } };

  it("shows who shares the membership and offers Leave", () => {
    const root = render(partner);
    expect(detail(root, "Shared by")).toBe("Sam Owner");
    expect(buttonLabels(root)).toContain("Leave membership");
    expect(find(root, byAttr("name", "membershipId"))?.attrs.value).toBe("0190f2a0-0000-7000-8000-000000000001");
  });

  it("shows no invite form and no partner management", () => {
    const root = render({ ...partner, canInvite: true });
    expect(find(root, byAttr("name", "email"))).toBeUndefined();
    expect(buttonLabels(root)).not.toContain("Remove");
    expect(buttonLabels(root)).not.toContain("Send invite");
  });

  it("shows an approved freeze without a Cancel button", () => {
    const root = render({ ...partner, freezes: [FREEZE] });
    expect(textOf(root)).toContain("Approved");
    expect(buttonLabels(root)).not.toContain("Cancel");
  });
});

describe("MembershipCard as the owner", () => {
  it("shows no Leave and no 'Shared by'", () => {
    const root = render();
    expect(buttonLabels(root)).not.toContain("Leave membership");
    expect(detail(root, "Shared by")).toBeUndefined();
  });

  it("shows the invite form when a partner can be invited", () => {
    const root = render({ canInvite: true });
    expect(find(root, byAttr("name", "email"))).toBeDefined();
    expect(buttonLabels(root)).toContain("Send invite");
  });

  it("shows the pending invite with Resend and Revoke instead of the invite form", () => {
    const root = render({
      canInvite: true,
      pendingInvite: { id: "invite-1", email: "partner@example.test", createdAt: at(-HOUR), expiresAt: at(2 * DAY) },
    });
    expect(textOf(root)).toContain("partner@example.test");
    expect(find(root, byAttr("name", "email"))).toBeUndefined();
    expect(buttonLabels(root)).toEqual(expect.arrayContaining(["Resend", "Revoke"]));
  });

  it("lists each partner with a Remove button", () => {
    const root = render({ partners: [{ seatId: "seat-1", name: "Pat Partner", joinedAt: at(-DAY) }] });
    expect(textOf(root)).toContain("Pat Partner");
    expect(buttonLabels(root)).toContain("Remove");
    expect(find(root, byAttr("name", "seatId"))?.attrs.value).toBe("seat-1");
  });

  it("shows nothing about partners when none can join or is waiting", () => {
    expect(textOf(render())).not.toContain("Partner");
  });
});

describe("MembershipCard freezes", () => {
  const request = { earliestStart: startOfZonedDay({ year: 2026, month: 12, day: 4 }, TZ) };

  it("shows the request form only when a freeze can be requested", () => {
    expect(find(render(), byAttr("name", "firstDay"))).toBeUndefined();
    expect(find(render(), byAttr("name", "lastDay"))).toBeUndefined();

    const root = render({ freezeRequest: request });
    const first = find(root, byAttr("name", "firstDay"));
    const last = find(root, byAttr("name", "lastDay"));
    expect(first?.attrs.type).toBe("date");
    expect(last?.attrs.type).toBe("date");
    expect(first?.attrs.min).toBe("2026-12-04");
    expect(buttonLabels(root)).toContain("Request freeze");
  });

  it("lists the freezes with their dates and status", () => {
    const root = render({ freezes: [FREEZE] });
    expect(textOf(root)).toContain("10 Dec 2026 – 16 Dec 2026 (7 days)");
    expect(textOf(root)).toContain("Approved");
  });

  it("offers Cancel on a freeze that hasn't started, and not on one that has", () => {
    expect(buttonLabels(render({ freezes: [FREEZE] }))).toContain("Cancel");
    const started: MyFreeze = { ...FREEZE, startsAt: at(-DAY), endsAt: at(5 * DAY) };
    expect(buttonLabels(render({ freezes: [started] }))).not.toContain("Cancel");
  });

  it("shows the reason a freeze was rejected", () => {
    const rejected: MyFreeze = { ...FREEZE, status: "REJECTED", reason: "Closed for repairs" };
    const root = render({ freezes: [rejected] });
    expect(textOf(root)).toContain("Rejected");
    expect(textOf(root)).toContain("Reason: Closed for repairs");
  });
});
