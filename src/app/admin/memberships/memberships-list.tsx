import Link from "next/link";
import { DataTable } from "@/components/data-table";
import { EmptyState } from "@/components/empty-state";
import { CheckboxField, SelectField } from "@/components/form-field";
import { Pagination } from "@/components/pagination";
import { MembershipStatusBadge, membershipStatusLabel } from "@/components/status-badge";
import { TextLink } from "@/components/text-link";
import { Button, buttonVariants } from "@/components/ui/button";
import { NativeSelectOption } from "@/components/ui/native-select";
import { requirePageUser } from "@/lib/auth/session";
import { formatDay } from "@/lib/memberships-ui/display";
import { MEMBERSHIP_SOURCE_LABELS } from "@/lib/memberships-ui/labels";
import {
  listMemberships,
  MEMBERSHIP_SOURCES,
  MEMBERSHIP_STATUSES,
  type MembershipListFilters,
} from "@/lib/services/memberships/queries";

type SearchParams = PageProps<"/admin/memberships">["searchParams"];

const FILTER_KEYS = ["status", "planId", "source", "expiring"] as const;

/** The list URL with the given filters and page; empty filters are left out. */
function membershipsHref(filters: Partial<Record<(typeof FILTER_KEYS)[number], string>>, page = 1): string {
  const params = new URLSearchParams();
  for (const key of FILTER_KEYS) {
    const value = filters[key];
    if (value) params.set(key, value);
  }
  if (page > 1) params.set("page", String(page));
  const search = params.toString();
  return `/admin/memberships${search ? `?${search}` : ""}`;
}

function filterValues(filters: MembershipListFilters) {
  return {
    status: filters.status ?? undefined,
    planId: filters.planId ?? undefined,
    source: filters.source ?? undefined,
    expiring: filters.expiring ? "true" : undefined,
  };
}

function hasFilters(filters: MembershipListFilters): boolean {
  return Boolean(filters.status || filters.planId || filters.source || filters.expiring);
}

function FilterForm({ filters, plans }: { filters: MembershipListFilters; plans: { id: string; name: string; active: boolean }[] }) {
  return (
    <form role="search" aria-label="Filter memberships" className="mb-4 flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-3">
        <SelectField id="filter-status" name="status" label="Status" defaultValue={filters.status ?? ""} className="w-full">
          <NativeSelectOption value="">Any status</NativeSelectOption>
          {MEMBERSHIP_STATUSES.map((status) => (
            <NativeSelectOption key={status} value={status}>
              {membershipStatusLabel(status)}
            </NativeSelectOption>
          ))}
        </SelectField>
        <SelectField id="filter-plan" name="planId" label="Plan" defaultValue={filters.planId ?? ""} className="w-full">
          <NativeSelectOption value="">Any plan</NativeSelectOption>
          {plans.map((plan) => (
            <NativeSelectOption key={plan.id} value={plan.id}>
              {plan.active ? plan.name : `${plan.name} (no longer offered)`}
            </NativeSelectOption>
          ))}
        </SelectField>
        <SelectField id="filter-source" name="source" label="Source" defaultValue={filters.source ?? ""} className="w-full">
          <NativeSelectOption value="">Any source</NativeSelectOption>
          {MEMBERSHIP_SOURCES.map((source) => (
            <NativeSelectOption key={source} value={source}>
              {MEMBERSHIP_SOURCE_LABELS[source]}
            </NativeSelectOption>
          ))}
        </SelectField>
      </div>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <CheckboxField id="filter-expiring" name="expiring" value="true" label="Ending in the next 7 days" defaultChecked={filters.expiring} />
        <div className="flex gap-2">
          <Button type="submit" variant="outline">
            Apply
          </Button>
          {hasFilters(filters) ? (
            <Link href="/admin/memberships" className={buttonVariants({ variant: "ghost" })}>
              Clear
            </Link>
          ) : null}
        </div>
      </div>
    </form>
  );
}

/** Every membership, filtered by display status, plan, source, and "ending soon", with paging that keeps the filters. */
export async function MembershipsList({ searchParams }: { searchParams: SearchParams }) {
  const raw = await searchParams;
  const rawFilters = Object.fromEntries(FILTER_KEYS.map((key) => [key, typeof raw[key] === "string" ? raw[key] : undefined]));
  await requirePageUser(membershipsHref(rawFilters), "ADMIN");
  const { memberships, total, page, pageCount, filters, plans, timeZone } = await listMemberships({ ...rawFilters, page: raw.page });

  return (
    <>
      <FilterForm filters={filters} plans={plans} />

      <p className="mb-2 text-sm text-muted-foreground">
        {total} {total === 1 ? "membership" : "memberships"}
      </p>

      {memberships.length === 0 ? (
        <EmptyState title="No memberships found" description={hasFilters(filters) ? "Try other filters." : undefined} />
      ) : (
        <DataTable
          label="Memberships"
          rows={memberships}
          rowKey={(m) => m.id}
          columns={[
            {
              id: "owner",
              header: "Owner",
              grow: true,
              wrap: true,
              stackedLabel: false,
              cell: (m) => (
                <>
                  <p>
                    <TextLink href={`/admin/members/${m.owner.id}`}>{m.owner.name}</TextLink>
                  </p>
                  <p className="text-muted-foreground">{m.owner.email}</p>
                </>
              ),
            },
            {
              id: "plan",
              header: "Plan",
              cell: (m) => (
                <>
                  <p>
                    <TextLink href={`/admin/memberships/${m.id}`}>{m.plan.name}</TextLink>
                  </p>
                  <p className="text-muted-foreground">
                    {MEMBERSHIP_SOURCE_LABELS[m.source]} · {m.openSeats} {m.openSeats === 1 ? "seat" : "seats"}
                  </p>
                </>
              ),
            },
            { id: "status", header: "Status", cell: (m) => <MembershipStatusBadge status={m.status} /> },
            {
              id: "end",
              header: "End",
              cell: (m) => (m.endedAt ? `Ended ${formatDay(m.endedAt, timeZone)}` : formatDay(m.currentPeriodEnd, timeZone)),
            },
          ]}
        />
      )}

      <Pagination page={page} pageCount={pageCount} hrefFor={(target) => membershipsHref(filterValues(filters), target)} />
    </>
  );
}
