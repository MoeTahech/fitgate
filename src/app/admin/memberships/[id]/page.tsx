import type { Metadata } from "next";
import { Suspense } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { MembershipDetailView } from "./membership-detail";

export const metadata: Metadata = { title: "Membership" };

function MembershipDetailSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <Skeleton className="h-12 w-64 rounded-lg" />
      <Skeleton className="h-40 rounded-xl" />
      <Skeleton className="h-72 rounded-xl" />
    </div>
  );
}

export default function AdminMembershipPage({ params }: PageProps<"/admin/memberships/[id]">) {
  return (
    <main>
      <Suspense fallback={<MembershipDetailSkeleton />}>
        <MembershipDetailView params={params} />
      </Suspense>
    </main>
  );
}
