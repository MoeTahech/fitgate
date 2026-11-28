import type { Metadata } from "next";
import { Suspense } from "react";
import { DetailList } from "@/components/detail-list";
import { PageContainer } from "@/components/page-container";
import { PageHeader } from "@/components/page-header";
import { SignOutButton } from "@/components/sign-out-button";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ROLE_LABELS } from "@/lib/auth/constants";
import { requirePageUser } from "@/lib/auth/session";
import { getMyMemberships } from "@/lib/services/memberships/queries";
import { MembershipSummaryCard } from "./membership-summary";

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
  return <MembershipSummaryCard memberships={current} timeZone={timeZone} now={new Date()} />;
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
