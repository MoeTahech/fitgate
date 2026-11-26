import { describe, expect, it } from "vitest";
import { FreezeStatus, InviteStatus, MembershipStatus, PaymentStatus } from "@/generated/prisma/enums";
import { classesOf, renderMarkup, textOf } from "../../tests/support/markup";
import { FreezeStatusBadge, InviteStatusBadge, MembershipStatusBadge, PaymentStatusBadge } from "./status-badge";
import type { StatusTone } from "./status-badge";

function badge(element: Parameters<typeof renderMarkup>[0]) {
  const root = renderMarkup(element);
  const span = root.children[0];
  if (typeof span === "string") throw new Error("Expected an element");
  return { label: textOf(span), classes: classesOf(span) };
}

function expectDisplay(element: Parameters<typeof renderMarkup>[0], label: string, tone: StatusTone) {
  const rendered = badge(element);
  expect(rendered.label).toBe(label);
  expect(rendered.classes).toContain(`bg-status-${tone}`);
  expect(rendered.classes).toContain(`text-status-${tone}-foreground`);
}

describe("FreezeStatusBadge", () => {
  const expected: Record<FreezeStatus, [string, StatusTone]> = {
    REQUESTED: ["Requested", "pending"],
    APPROVED: ["Approved", "frozen"],
    COMPLETED: ["Completed", "expired"],
    REJECTED: ["Rejected", "past-due"],
    CANCELLED: ["Cancelled", "cancelled"],
  };

  it.each(Object.values(FreezeStatus))("shows %s with its label and tone", (status) => {
    const [label, tone] = expected[status];
    expectDisplay(<FreezeStatusBadge status={status} />, label, tone);
  });
});

describe("PaymentStatusBadge", () => {
  const expected: Record<PaymentStatus, [string, StatusTone]> = {
    SUCCEEDED: ["Paid", "active"],
    PARTIALLY_REFUNDED: ["Partly refunded", "pending"],
    REFUNDED: ["Refunded", "expired"],
    VOIDED: ["Voided", "cancelled"],
    PENDING: ["Pending", "pending"],
    FAILED: ["Failed", "past-due"],
    DISPUTED: ["Disputed", "past-due"],
  };

  it.each(Object.values(PaymentStatus))("shows %s with its label and tone", (status) => {
    const [label, tone] = expected[status];
    expectDisplay(<PaymentStatusBadge status={status} />, label, tone);
  });
});

describe("existing status badges", () => {
  it.each(Object.values(MembershipStatus))("renders a labelled membership badge for %s", (status) => {
    expect(badge(<MembershipStatusBadge status={status} />).label).not.toBe("");
  });

  it.each(Object.values(InviteStatus))("renders a labelled invite badge for %s", (status) => {
    expect(badge(<InviteStatusBadge status={status} />).label).not.toBe("");
  });
});
