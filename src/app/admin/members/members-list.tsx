import { DataTable } from "@/components/data-table";
import { EmptyState } from "@/components/empty-state";
import { Pagination } from "@/components/pagination";
import { MembershipStatusBadge } from "@/components/status-badge";
import { TextLink } from "@/components/text-link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { requirePageUser } from "@/lib/auth/session";
import { formatDay } from "@/lib/memberships-ui/display";
import { listMembers, type BaseSummary } from "@/lib/services/memberships/queries";

type SearchParams = PageProps<"/admin/members">["searchParams"];

function membersHref({ q, page }: { q?: string; page?: number }): string {
  const params = new URLSearchParams();
  if (q) params.set("q", q);
  if (page && page > 1) params.set("page", String(page));
  const search = params.toString();
  return `/admin/members${search ? `?${search}` : ""}`;
}

function BaseMembership({ base, timeZone }: { base: BaseSummary | null; timeZone: string }) {
  if (!base) return <p className="text-muted-foreground">None</p>;
  const detail =
    base.seatRole === "PARTNER"
      ? "Partner seat"
      : base.endedAt
        ? `Ended ${formatDay(base.endedAt, timeZone)}`
        : `Until ${formatDay(base.currentPeriodEnd, timeZone)}`;
  return (
    <>
      <p className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{base.planName}</span>
        <MembershipStatusBadge status={base.status} />
      </p>
      <p className="text-muted-foreground">{detail}</p>
    </>
  );
}

/** The admin's member list: search, base membership, and paging. */
export async function MembersList({ searchParams }: { searchParams: SearchParams }) {
  const raw = await searchParams;
  await requirePageUser(membersHref({ q: typeof raw.q === "string" ? raw.q : undefined }), "ADMIN");
  const { members, total, page, pageCount, query, timeZone } = await listMembers({ q: raw.q, page: raw.page });

  return (
    <>
      <form role="search" className="mb-4 flex gap-2">
        <Input
          type="search"
          name="q"
          defaultValue={query}
          placeholder="Search by name or email"
          aria-label="Search members"
          maxLength={100}
          className="flex-1"
        />
        <Button type="submit" variant="outline">
          Search
        </Button>
      </form>

      <p className="mb-2 text-sm text-muted-foreground">
        {total} {total === 1 ? "member" : "members"}
      </p>

      {members.length === 0 ? (
        <EmptyState title="No members found" description={query ? "Try a different name or email." : undefined} />
      ) : (
        <DataTable
          label="Members"
          rows={members}
          rowKey={(member) => member.id}
          columns={[
            {
              id: "member",
              header: "Member",
              grow: true,
              stackedLabel: false,
              title: (member) => `${member.name}\n${member.email}`,
              cell: (member) => (
                <>
                  <p>
                    <TextLink href={`/admin/members/${member.id}`}>{member.name}</TextLink>
                  </p>
                  <p className="text-muted-foreground">{member.email}</p>
                </>
              ),
            },
            {
              id: "base",
              header: "Membership",
              cell: (member) => <BaseMembership base={member.base} timeZone={timeZone} />,
            },
            { id: "joined", header: "Joined", cell: (member) => formatDay(member.createdAt, timeZone) },
          ]}
        />
      )}

      <Pagination page={page} pageCount={pageCount} hrefFor={(target) => membersHref({ q: query, page: target })} />
    </>
  );
}
