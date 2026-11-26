import type { Metadata } from "next";
import { Suspense } from "react";
import { PageContainer } from "@/components/page-container";
import { PageHeader } from "@/components/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { MembershipView } from "./membership-view";

export const metadata: Metadata = { title: "Membership" };

function MembershipSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      <Skeleton className="h-48 rounded-xl" />
      <Skeleton className="h-32 rounded-xl" />
    </div>
  );
}

export default function MembershipPage() {
  return (
    <PageContainer width="narrow">
      <PageHeader title="Membership" description="Your plan, trials, and payments." />
      <Suspense fallback={<MembershipSkeleton />}>
        <MembershipView />
      </Suspense>
    </PageContainer>
  );
}
