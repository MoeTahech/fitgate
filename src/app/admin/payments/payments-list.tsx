import Link from "next/link";
import { DataTable } from "@/components/data-table";
import { EmptyState } from "@/components/empty-state";
import { InputField, SelectField } from "@/components/form-field";
import { Pagination } from "@/components/pagination";
import { PaymentStatusBadge, paymentStatusLabel } from "@/components/status-badge";
import { TextLink } from "@/components/text-link";
import { Button, buttonVariants } from "@/components/ui/button";
import { NativeSelectOption } from "@/components/ui/native-select";
import { requirePageUser } from "@/lib/auth/session";
import { PAYMENT_METHOD_LABELS } from "@/lib/memberships-ui/labels";
import { formatMoney } from "@/lib/money";
import {
  listPayments,
  PAYMENT_METHODS,
  PAYMENT_STATUSES,
  type PaymentListFilters,
} from "@/lib/services/memberships/queries";
import { formatLocal } from "@/lib/time";
import { PaymentTotalsSummary } from "./payment-totals";

type SearchParams = PageProps<"/admin/payments">["searchParams"];

const FILTER_KEYS = ["method", "status", "from", "to"] as const;

type FilterValues = Partial<Record<(typeof FILTER_KEYS)[number], string>>;

/** The list URL with the given filters and page; empty filters are left out. */
function paymentsHref(filters: FilterValues, page = 1): string {
  const params = new URLSearchParams();
  for (const key of FILTER_KEYS) {
    const value = filters[key];
    if (value) params.set(key, value);
  }
  if (page > 1) params.set("page", String(page));
  const search = params.toString();
  return `/admin/payments${search ? `?${search}` : ""}`;
}

function filterValues(filters: PaymentListFilters): FilterValues {
  return {
    method: filters.method ?? undefined,
    status: filters.status ?? undefined,
    from: filters.from ?? undefined,
    to: filters.to ?? undefined,
  };
}

function hasFilters(filters: PaymentListFilters): boolean {
  return Boolean(filters.method || filters.status || filters.from || filters.to);
}

function FilterForm({ filters }: { filters: PaymentListFilters }) {
  return (
    <form role="search" aria-label="Filter payments" className="mb-4 flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <SelectField id="filter-method" name="method" label="Method" defaultValue={filters.method ?? ""} className="w-full">
          <NativeSelectOption value="">Any method</NativeSelectOption>
          {PAYMENT_METHODS.map((method) => (
            <NativeSelectOption key={method} value={method}>
              {PAYMENT_METHOD_LABELS[method]}
            </NativeSelectOption>
          ))}
        </SelectField>
        <SelectField id="filter-status" name="status" label="Status" defaultValue={filters.status ?? ""} className="w-full">
          <NativeSelectOption value="">Any status</NativeSelectOption>
          {PAYMENT_STATUSES.map((status) => (
            <NativeSelectOption key={status} value={status}>
              {paymentStatusLabel(status)}
            </NativeSelectOption>
          ))}
        </SelectField>
        <InputField id="filter-from" name="from" type="date" label="Paid from" defaultValue={filters.from ?? ""} />
        <InputField id="filter-to" name="to" type="date" label="Paid to" defaultValue={filters.to ?? ""} />
      </div>
      <div className="flex gap-2">
        <Button type="submit" variant="outline">
          Apply
        </Button>
        {hasFilters(filters) ? (
          <Link href="/admin/payments" className={buttonVariants({ variant: "ghost" })}>
            Clear
          </Link>
        ) : null}
      </div>
    </form>
  );
}

/** Every payment, filtered by method, status, and paid date, with totals per currency and paging that keeps the filters. */
export async function PaymentsList({ searchParams }: { searchParams: SearchParams }) {
  const raw = await searchParams;
  const rawFilters = Object.fromEntries(FILTER_KEYS.map((key) => [key, typeof raw[key] === "string" ? raw[key] : undefined]));
  await requirePageUser(paymentsHref(rawFilters), "ADMIN");
  const { payments, total, page, pageCount, totals, filters, timeZone } = await listPayments({ ...rawFilters, page: raw.page });

  return (
    <>
      <FilterForm filters={filters} />

      <PaymentTotalsSummary totals={totals} total={total} />

      {payments.length === 0 ? (
        <EmptyState title="No payments found" description={hasFilters(filters) ? "Try other filters." : undefined} />
      ) : (
        <DataTable
          label="Payments"
          rows={payments}
          rowKey={(payment) => payment.id}
          columns={[
            {
              id: "paid",
              header: "Paid",
              cell: (payment) => (
                <div className="flex flex-col items-start gap-1">
                  <span>{payment.paidAt ? formatLocal(payment.paidAt, timeZone) : "Not paid"}</span>
                  <PaymentStatusBadge status={payment.status} />
                </div>
              ),
            },
            {
              id: "member",
              header: "Member",
              grow: true,
              stackedLabel: false,
              cell: (payment) => (
                <>
                  <p>
                    <TextLink href={`/admin/members/${payment.member.id}`}>{payment.member.name}</TextLink>
                  </p>
                  <p className="text-muted-foreground">
                    {payment.planName ?? "No plan"}
                    {payment.membershipId ? (
                      <>
                        {" · "}
                        <TextLink href={`/admin/memberships/${payment.membershipId}`}>View membership</TextLink>
                      </>
                    ) : null}
                  </p>
                  {payment.reference ? <p className="text-muted-foreground">Reference {payment.reference}</p> : null}
                  {payment.recordedByName ? <p className="text-muted-foreground">Recorded by {payment.recordedByName}</p> : null}
                </>
              ),
            },
            {
              id: "amount",
              header: "Amount",
              cell: (payment) => (
                <>
                  <p className="font-medium">{formatMoney(payment.amountCents, payment.currency)}</p>
                  {payment.amountRefundedCents > 0 ? (
                    <p className="text-muted-foreground">Refunded {formatMoney(payment.amountRefundedCents, payment.currency)}</p>
                  ) : null}
                </>
              ),
            },
            { id: "method", header: "Method", cell: (payment) => PAYMENT_METHOD_LABELS[payment.method] },
          ]}
        />
      )}

      <Pagination page={page} pageCount={pageCount} hrefFor={(target) => paymentsHref(filterValues(filters), target)} />
    </>
  );
}
