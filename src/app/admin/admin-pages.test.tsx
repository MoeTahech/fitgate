import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionUser } from "@/lib/auth/guards";
import { db } from "@/lib/db";
import { resetDatabase } from "../../../tests/support/database";
import { createManualPayment, createOwnedMembership, createPlan, createUser } from "../../../tests/support/factories";
import { byAttr, byTag, classesOf, find, findAll, renderMarkup, textOf } from "../../../tests/support/markup";
import { MemberDetailView } from "./members/[userId]/member-detail";
import { MembersList } from "./members/members-list";
import { MembershipDetailView } from "./memberships/[id]/membership-detail";
import { MembershipsList } from "./memberships/memberships-list";
import { PaymentsList } from "./payments/payments-list";

const session = vi.hoisted(() => ({ user: null as SessionUser | null }));

vi.mock("@/lib/auth/session", async () => {
  const guards = await import("@/lib/auth/guards");
  return { ...guards, ...guards.createGuards(async () => session.user) };
});

const NOT_FOUND_DIGEST = "NEXT_HTTP_ERROR_FALLBACK;404";

type Target = { memberId: string; membershipId: string };

type PageCase = {
  name: string;
  path: (target: Target) => string;
  render: (target: Target) => Promise<ReactElement>;
  /** Something only the rendered page contains. */
  marker: (root: ReturnType<typeof renderMarkup>, target: Target) => boolean;
};

const PAGES: PageCase[] = [
  {
    name: "members list",
    path: () => "/admin/members",
    render: () => MembersList({ searchParams: Promise.resolve({}) }),
    marker: (root) => Boolean(find(root, byAttr("role", "search"))),
  },
  {
    name: "member detail",
    path: ({ memberId }) => `/admin/members/${memberId}`,
    render: ({ memberId }) => MemberDetailView({ params: Promise.resolve({ userId: memberId }) }),
    marker: (root) => textOf(root).includes("Gina Guarded"),
  },
  {
    name: "memberships list",
    path: () => "/admin/memberships",
    render: () => MembershipsList({ searchParams: Promise.resolve({}) }),
    marker: (root) => Boolean(find(root, byAttr("aria-label", "Filter memberships"))),
  },
  {
    name: "membership detail",
    path: ({ membershipId }) => `/admin/memberships/${membershipId}`,
    render: ({ membershipId }) => MembershipDetailView({ params: Promise.resolve({ id: membershipId }) }),
    marker: (root) => textOf(root).includes("Gina Guarded"),
  },
  {
    name: "payments",
    path: () => "/admin/payments",
    render: () => PaymentsList({ searchParams: Promise.resolve({}) }),
    marker: (root) => Boolean(find(root, byAttr("aria-label", "Filter payments"))),
  },
];

async function digestOf(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
  } catch (error) {
    return (error as { digest?: string }).digest;
  }
  return undefined;
}

let target: Target;

function sessionUser(role: SessionUser["role"]): SessionUser {
  return { id: "00000000-0000-4000-8000-000000000000", name: `Test ${role}`, email: `${role}@example.test`, role };
}

beforeEach(async () => {
  await resetDatabase();
  await db.gymSettings.create({ data: { id: 1, name: "Gym", timeZone: "Asia/Beirut", capacity: 50 } });
  await db.openingHours.createMany({
    data: [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ weekday, opensAtMin: 360, closesAtMin: 1320 })),
  });
  const member = await createUser({ name: "Gina Guarded" });
  const plan = await createPlan();
  const membership = await createOwnedMembership(member, plan);
  await createManualPayment(membership, member.id);
  target = { memberId: member.id, membershipId: membership.id };
});

afterEach(() => {
  session.user = null;
});

describe.each([
  {
    name: "members list",
    render: () => MembersList({ searchParams: Promise.resolve({ q: "gina", page: "3" }) }),
    next: "/admin/members?q=gina&page=3",
  },
  {
    name: "memberships list",
    render: () => MembershipsList({ searchParams: Promise.resolve({ status: "ACTIVE", page: "3" }) }),
    next: "/admin/memberships?status=ACTIVE&page=3",
  },
  {
    name: "payments",
    render: () => PaymentsList({ searchParams: Promise.resolve({ method: "CASH", page: "3" }) }),
    next: "/admin/payments?method=CASH&page=3",
  },
])("admin $name sign-in return path", ({ render, next }) => {
  it("keeps the filters and the page", async () => {
    session.user = null;
    expect(await digestOf(render())).toContain(`/sign-in?next=${encodeURIComponent(next)}`);
  });
});

describe("admin member detail payments", () => {
  it("shows a long reference and the recorder in the wrapping plan column", async () => {
    session.user = sessionUser("ADMIN");
    const membership = await db.membership.findUniqueOrThrow({ where: { id: target.membershipId } });
    const reference = `BANK-TRANSFER-${"0123456789".repeat(6)}`;
    await createManualPayment(membership, target.memberId, { reference });

    const root = renderMarkup(await MemberDetailView({ params: Promise.resolve({ userId: target.memberId }) }));
    const table = find(root, byAttr("aria-label", "Payments of Gina Guarded"));
    expect(table).toBeDefined();
    const cell = find(table!, (element) => element.tag === "td" && textOf(element).includes(reference));
    expect(classesOf(cell)).toContain("wrap-anywhere");
    expect(textOf(cell!)).toContain("Recorded by Gina Guarded");
    expect(findAll(table!, byTag("th")).map(textOf)).not.toContain("Recorded by");
  });
});

describe.each(PAGES)("admin $name", (page) => {
  it.each(["MEMBER", "TRAINER"] as const)("is a 404 for a %s", async (role) => {
    session.user = sessionUser(role);
    expect(await digestOf(page.render(target))).toBe(NOT_FOUND_DIGEST);
  });

  it("redirects a signed-out visitor to sign-in, returning to the page", async () => {
    session.user = null;
    const digest = await digestOf(page.render(target));
    expect(digest).toMatch(/^NEXT_REDIRECT;/);
    expect(digest).toContain(`/sign-in?next=${encodeURIComponent(page.path(target))}`);
  });

  it("renders for an admin", async () => {
    session.user = sessionUser("ADMIN");
    const root = renderMarkup(await page.render(target));
    expect(page.marker(root, target)).toBe(true);
  });
});
