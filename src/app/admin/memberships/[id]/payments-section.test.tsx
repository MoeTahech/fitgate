import { describe, expect, it } from "vitest";
import { ActionResultsProvider } from "@/components/action-results";
import type { MembershipDetailPayment } from "@/lib/services/memberships/queries";
import { byTag, classesOf, elements, find, findAll, renderMarkup, textOf } from "../../../../../tests/support/markup";
import { PaymentsSection } from "./payments-section";

const TZ = "Asia/Beirut";
// Wednesday 2 December 2026, 10:00 in Beirut (UTC+2).
const NOW = new Date("2026-12-02T08:00:00.000Z");
const PERIOD_START = new Date("2026-11-02T08:00:00.000Z");
const PERIOD_END = new Date("2026-12-02T08:00:00.000Z");

function payment(overrides: Partial<MembershipDetailPayment>): MembershipDetailPayment {
  return {
    id: "payment",
    membershipId: "membership",
    planName: "Basic",
    member: { id: "member", name: "Sam Member" },
    method: "CASH",
    status: "SUCCEEDED",
    amountCents: 3000,
    amountRefundedCents: 0,
    currency: "usd",
    periodStart: PERIOD_START,
    periodEnd: PERIOD_END,
    paidAt: PERIOD_START,
    reference: null,
    recordedByName: "Front Desk",
    createdAt: PERIOD_START,
    note: null,
    voidedAt: null,
    voidedByName: null,
    voidReason: null,
    refundedAt: null,
    refundedByName: null,
    refundReason: null,
    corrections: { canVoid: false, canRefund: false, canRefundFull: false },
    ...overrides,
  };
}

const VOIDED = payment({
  id: "voided",
  status: "VOIDED",
  reference: "TX-42",
  note: "Paid at the desk",
  voidedAt: NOW,
  voidedByName: "MoeTahech",
  voidReason: "Recorded By Mistake",
});

const REFUNDED = payment({
  id: "refunded",
  status: "PARTIALLY_REFUNDED",
  amountRefundedCents: 1250,
  refundedAt: NOW,
  refundedByName: "MoeTahech",
  refundReason: "Goodwill",
});

function render(payments: MembershipDetailPayment[]) {
  return renderMarkup(
    <ActionResultsProvider>
      <PaymentsSection payments={payments} membership={{ status: "ACTIVE", currentPeriodStart: PERIOD_START }} timeZone={TZ} now={NOW} />
    </ActionResultsProvider>,
  );
}

/** The History cell of each payment row, as its list of lines. */
function historyLines(root: ReturnType<typeof render>) {
  const rows = elements(find(root, byTag("tbody"))!);
  return rows.map((row) => findAll(elements(row)[1], byTag("li")).map(textOf));
}

describe("PaymentsSection", () => {
  it("shows who voided and who refunded a payment, when, and why, with its reference and note", () => {
    expect(historyLines(render([VOIDED, REFUNDED]))).toEqual([
      ["Recorded by Front Desk", "Reference: TX-42", "Note: Paid at the desk", "Voided 2 Dec 2026 by MoeTahech: Recorded By Mistake"],
      ["Recorded by Front Desk", "Refunded US$12.50 on 2 Dec 2026 by MoeTahech: Goodwill"],
    ]);
  });

  it("wraps the history in table mode, so reasons are never cut off", () => {
    const root = render([VOIDED]);
    const history = elements(elements(find(root, byTag("tbody"))!)[0])[1];
    expect(classesOf(history)).not.toContain("@2xl/data-table:*:truncate");
    expect(classesOf(history)).toContain("wrap-anywhere");
  });

  it("shows the amount with its status, refunded amount, method, paid date, and covered period", () => {
    const root = render([REFUNDED]);
    const summary = textOf(elements(elements(find(root, byTag("tbody"))!)[0])[0]);
    expect(summary).toContain("US$30.00");
    expect(summary).toContain("Partly refunded");
    expect(summary).toContain("Refunded US$12.50");
    expect(summary).toContain("Cash, 2 Nov 2026");
    expect(summary).toContain("Covers 2 Nov 2026 – 2 Dec 2026");
  });

  it("offers only the corrections a payment accepts", () => {
    const correctable = payment({ id: "open", corrections: { canVoid: true, canRefund: true, canRefundFull: true } });
    const root = render([correctable, VOIDED]);
    const [open, voided] = elements(find(root, byTag("tbody"))!);
    expect(findAll(open, byTag("button")).map(textOf)).toEqual(["Void", "Refund"]);
    expect(findAll(voided, byTag("button"))).toEqual([]);
  });
});
