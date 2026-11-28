import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatMoney } from "@/lib/money";
import type { PaymentTotals } from "@/lib/services/memberships/queries";

function TotalsCard({ totals }: { totals: PaymentTotals }) {
  const currency = totals.currency.toUpperCase();
  return (
    <Card>
      <CardHeader>
        <CardTitle>{currency}</CardTitle>
      </CardHeader>
      <CardContent>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
          <div>
            <dt className="text-sm text-muted-foreground">Gross</dt>
            <dd className="font-medium">{formatMoney(totals.grossCents, totals.currency)}</dd>
          </div>
          <div>
            <dt className="text-sm text-muted-foreground">Refunded</dt>
            <dd className="font-medium">{formatMoney(totals.refundedCents, totals.currency)}</dd>
          </div>
          <div>
            <dt className="text-sm text-muted-foreground">Net</dt>
            <dd className="font-medium">{formatMoney(totals.netCents, totals.currency)}</dd>
          </div>
          <div>
            <dt className="text-sm text-muted-foreground">Payments</dt>
            <dd className="font-medium">{totals.count}</dd>
          </div>
        </dl>
      </CardContent>
    </Card>
  );
}

/** Read by both the totals' accessible name and the visible note, so they can't drift apart. */
const TOTALS_EXCLUSION = "exclude voided, pending, and failed payments";

/** Totals per currency over the filtered payments, then the payment count with what the totals leave out. */
export function PaymentTotalsSummary({ totals, total }: { totals: readonly PaymentTotals[]; total: number }) {
  return (
    <>
      {totals.length > 0 ? (
        <div className="mb-4 grid gap-4 md:grid-cols-2" aria-label={`Totals ${TOTALS_EXCLUSION}`}>
          {totals.map((entry) => (
            <TotalsCard key={entry.currency} totals={entry} />
          ))}
        </div>
      ) : null}

      <p className="mb-2 text-sm text-muted-foreground">
        {total} {total === 1 ? "payment" : "payments"}
        {totals.length > 0 ? ` · totals ${TOTALS_EXCLUSION}` : ""}
      </p>
    </>
  );
}
