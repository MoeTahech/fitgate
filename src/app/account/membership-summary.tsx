import Link from "next/link";
import { DetailList, type DetailItem } from "@/components/detail-list";
import { MembershipStatusBadge } from "@/components/status-badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { periodText } from "@/lib/memberships-ui/display";
import type { MyMembership } from "@/lib/services/memberships/queries";

function summaryItems(membership: MyMembership, timeZone: string, now: Date): DetailItem[] {
  const items: DetailItem[] = [{ term: "Period", value: periodText(membership, timeZone, now) }];
  if (membership.creditBalance !== null) items.push({ term: "Credits left", value: membership.creditBalance });
  return items;
}

/** Every current membership (base and add-ons) with its status, period, and credits, linking to the membership page. */
export function MembershipSummaryCard({ memberships, timeZone, now }: { memberships: readonly MyMembership[]; timeZone: string; now: Date }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle role="heading" aria-level={2}>
          Membership
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        {memberships.length === 0 ? (
          <p className="text-muted-foreground">You don&apos;t have a membership right now.</p>
        ) : (
          memberships.map((membership) => (
            <section key={membership.id} className="flex flex-col gap-3 border-t pt-4 first:border-t-0 first:pt-0">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="font-medium wrap-anywhere">{membership.plan.name}</h3>
                <MembershipStatusBadge status={membership.status} />
              </div>
              <DetailList items={summaryItems(membership, timeZone, now)} />
            </section>
          ))
        )}
      </CardContent>
      <CardFooter>
        <Link href="/account/membership" className={buttonVariants({ variant: "outline" })}>
          View membership
        </Link>
      </CardFooter>
    </Card>
  );
}
