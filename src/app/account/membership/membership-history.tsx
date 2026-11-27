import { DataTable } from "@/components/data-table";
import { SectionHeader } from "@/components/page-header";
import { MembershipStatusBadge, PaymentStatusBadge, StatusBadge } from "@/components/status-badge";
import { formatDay, pastEntry, periodText, type PastEntry } from "@/lib/memberships-ui/display";
import { PAYMENT_METHOD_LABELS } from "@/lib/memberships-ui/labels";
import { formatMoney } from "@/lib/money";
import type { MyMembership, MyPayment } from "@/lib/services/memberships/queries";

function PastStatusBadge({ status }: { status: PastEntry["status"] }) {
  return status === "LEFT" ? <StatusBadge tone="cancelled">Left</StatusBadge> : <MembershipStatusBadge status={status} />;
}

export function PaymentHistory({ payments, timeZone }: { payments: readonly MyPayment[]; timeZone: string }) {
  if (payments.length === 0) return null;
  return (
    <section>
      <SectionHeader title="Payments" />
      <DataTable
        label="Your payments"
        rows={payments}
        rowKey={(payment) => payment.id}
        columns={[
          {
            id: "paid",
            header: "Paid",
            cell: (payment) => (payment.paidAt ? formatDay(payment.paidAt, timeZone) : "—"),
          },
          {
            id: "plan",
            header: "Plan",
            grow: true,
            cell: (payment) => <p className="font-medium">{payment.planName ?? "—"}</p>,
          },
          {
            id: "amount",
            header: "Amount",
            cell: (payment) => (
              <>
                <p>{formatMoney(payment.amountCents, payment.currency)}</p>
                {payment.amountRefundedCents > 0 ? (
                  <p className="text-muted-foreground">Refunded {formatMoney(payment.amountRefundedCents, payment.currency)}</p>
                ) : null}
              </>
            ),
          },
          { id: "method", header: "Method", cell: (payment) => PAYMENT_METHOD_LABELS[payment.method] },
          { id: "status", header: "Status", cell: (payment) => <PaymentStatusBadge status={payment.status} /> },
          {
            id: "covers",
            header: "Covers",
            cell: (payment) =>
              payment.periodStart && payment.periodEnd
                ? `${formatDay(payment.periodStart, timeZone)} – ${formatDay(payment.periodEnd, timeZone)}`
                : null,
          },
        ]}
      />
    </section>
  );
}

export function PastMemberships({ memberships, timeZone, now }: { memberships: readonly MyMembership[]; timeZone: string; now: Date }) {
  if (memberships.length === 0) return null;
  return (
    <section>
      <SectionHeader title="Past memberships" />
      <DataTable
        label="Your past memberships"
        rows={memberships}
        rowKey={(membership) => membership.id}
        columns={[
          {
            id: "plan",
            header: "Plan",
            grow: true,
            cell: (membership) => <p className="font-medium">{membership.plan.name}</p>,
          },
          { id: "status", header: "Status", cell: (membership) => <PastStatusBadge status={pastEntry(membership).status} /> },
          {
            id: "ended",
            header: "Ended",
            cell: (membership) => {
              const { endedAt } = pastEntry(membership);
              return endedAt ? formatDay(endedAt, timeZone) : "—";
            },
          },
          { id: "period", header: "Period", cell: (membership) => periodText(membership, timeZone, now) },
        ]}
      />
    </section>
  );
}
