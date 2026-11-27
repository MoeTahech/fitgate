import { DataTable } from "@/components/data-table";
import { EmptyState } from "@/components/empty-state";
import { SectionHeader } from "@/components/page-header";
import { PaymentStatusBadge } from "@/components/status-badge";
import type { MembershipStatus } from "@/generated/prisma/client";
import { correctionEffect, formatDay, paymentHistoryLines } from "@/lib/memberships-ui/display";
import { PAYMENT_METHOD_LABELS } from "@/lib/memberships-ui/labels";
import { formatMoney } from "@/lib/money";
import type { MembershipDetailPayment } from "@/lib/services/memberships/queries";
import { RefundPaymentButton, VoidPaymentButton } from "../row-actions";

type CorrectedMembership = { status: MembershipStatus; currentPeriodStart: Date };

function PaymentSummary({ payment, timeZone }: { payment: MembershipDetailPayment; timeZone: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{formatMoney(payment.amountCents, payment.currency)}</span>
        <PaymentStatusBadge status={payment.status} />
      </div>
      {payment.amountRefundedCents > 0 ? (
        <p className="text-muted-foreground">Refunded {formatMoney(payment.amountRefundedCents, payment.currency)}</p>
      ) : null}
      <p className="text-muted-foreground">
        {PAYMENT_METHOD_LABELS[payment.method]}
        {payment.paidAt ? `, ${formatDay(payment.paidAt, timeZone)}` : ""}
      </p>
      {payment.periodStart && payment.periodEnd ? (
        <p className="text-muted-foreground">
          Covers {formatDay(payment.periodStart, timeZone)} – {formatDay(payment.periodEnd, timeZone)}
        </p>
      ) : null}
    </div>
  );
}

/**
 * A membership's payments for the admin, with their full history (recorded, voided, refunded: by
 * whom, when, why), reference, and note, and the corrections each payment accepts.
 */
export function PaymentsSection({
  payments,
  membership,
  timeZone,
  now,
}: {
  payments: readonly MembershipDetailPayment[];
  membership: CorrectedMembership;
  timeZone: string;
  now: Date;
}) {
  return (
    <section>
      <SectionHeader title="Payments" />
      {payments.length === 0 ? (
        <EmptyState title="No payments" description="Trials have no payments." />
      ) : (
        <DataTable
          label="Payments"
          rows={payments}
          rowKey={(payment) => payment.id}
          columns={[
            { id: "payment", header: "Payment", cell: (payment) => <PaymentSummary payment={payment} timeZone={timeZone} /> },
            {
              id: "history",
              header: "History",
              grow: true,
              wrap: true,
              cell: (payment) => (
                <ul className="flex flex-col gap-0.5">
                  {paymentHistoryLines(payment, timeZone).map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              ),
            },
            {
              id: "actions",
              header: "Actions",
              hideHeader: true,
              align: "end",
              cell: (payment) => {
                const { canVoid, canRefund, canRefundFull } = payment.corrections;
                if (!canVoid && !canRefund) return null;
                return (
                  <div className="flex flex-wrap gap-2">
                    {canVoid ? (
                      <VoidPaymentButton paymentId={payment.id} description={correctionEffect(payment, membership, timeZone, now)} />
                    ) : null}
                    {canRefund ? (
                      <RefundPaymentButton
                        target={{
                          paymentId: payment.id,
                          amountCents: payment.amountCents,
                          currency: payment.currency,
                          canRefundFull,
                          periodStart: payment.periodStart,
                          membership,
                          timeZone,
                          now,
                        }}
                      />
                    ) : null}
                  </div>
                );
              },
            },
          ]}
        />
      )}
    </section>
  );
}
