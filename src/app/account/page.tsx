import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { DetailList } from "@/components/detail-list";
import { PageContainer } from "@/components/page-container";
import { PageHeader } from "@/components/page-header";
import { SignOutButton } from "@/components/sign-out-button";
import { MembershipStatusBadge } from "@/components/status-badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ROLE_LABELS } from "@/lib/auth/constants";
import { requirePageUser } from "@/lib/auth/session";
import { periodText } from "@/lib/memberships-ui/display";
import { getMyMemberships } from "@/lib/services/memberships/queries";

export const metadata: Metadata = { title: "Account" };

async function AccountDetails() {
  const user = await requirePageUser("/account");
  return (
    <Card>
      <CardContent>
        <DetailList
          items={[
            { term: "Name", value: user.name },
            { term: "Email", value: user.email },
            { term: "Role", value: ROLE_LABELS[user.role] },
          ]}
        />
      </CardContent>
      <CardFooter>
        <SignOutButton />
      </CardFooter>
    </Card>
  );
}

async function MembershipSummary() {
  await requirePageUser("/account");
  const { timeZone, current } = await getMyMemberships();
  const now = new Date();
  const base = current.find((membership) => membership.plan.type === "BASE");

  return (
    <Card>
      <CardHeader>
        <CardTitle role="heading" aria-level={2}>
          Membership
        </CardTitle>
      </CardHeader>
      <CardContent>
        {base ? (
          <DetailList
            items={[
              { term: "Plan", value: base.plan.name },
              { term: "Status", value: <MembershipStatusBadge status={base.status} /> },
              { term: "Period", value: periodText(base, timeZone, now) },
            ]}
          />
        ) : (
          <p className="text-muted-foreground">You don&apos;t have a membership right now.</p>
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

export default function AccountPage() {
  return (
    <PageContainer width="narrow">
      <PageHeader title="Your account" />
      <div className="flex flex-col gap-6">
        <Suspense fallback={<Skeleton className="h-56 rounded-xl" />}>
          <AccountDetails />
        </Suspense>
        <Suspense fallback={<Skeleton className="h-44 rounded-xl" />}>
          <MembershipSummary />
        </Suspense>
      </div>
    </PageContainer>
  );
}
