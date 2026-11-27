import { describe, expect, it } from "vitest";
import type { PaymentTotals } from "@/lib/services/memberships/queries";
import { byAttr, find, findAll, renderMarkup, textOf } from "../../../../tests/support/markup";
import { PaymentTotalsSummary } from "./payment-totals";

const USD: PaymentTotals = { currency: "usd", grossCents: 8000, refundedCents: 1250, netCents: 6750, count: 3 };

function render(totals: PaymentTotals[], total = 5) {
  return renderMarkup(
    <div>
      <PaymentTotalsSummary totals={totals} total={total} />
    </div>,
  );
}

describe("PaymentTotalsSummary", () => {
  it("labels the totals with the same exclusions the visible note states", () => {
    const root = render([USD]);
    const label = find(root, byAttr("aria-label"))?.attrs["aria-label"];
    const note = textOf(find(root, (element) => element.tag === "p")!).split(" · ")[1];

    expect(note).toBe("totals exclude voided, pending, and failed payments");
    expect(label?.toLowerCase()).toBe(note);
  });

  it("shows the totals of each currency", () => {
    const root = render([USD, { ...USD, currency: "eur" }]);
    const labelled = find(root, byAttr("aria-label"))!;
    expect(findAll(labelled, (element) => element.tag === "dl")).toHaveLength(2);
    expect(textOf(labelled)).toContain("US$67.50");
  });

  it("says nothing about totals when there are none", () => {
    const root = render([], 0);
    expect(find(root, byAttr("aria-label"))).toBeUndefined();
    expect(textOf(root)).toBe("0 payments");
  });
});
