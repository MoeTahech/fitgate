import type { Metadata } from "next";
import { Suspense } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { MemberDetailView } from "./member-detail";

export const metadata: Metadata = { title: "Member" };

function MemberDetailSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <Skeleton className="h-12 w-64 rounded-lg" />
      <Skeleton className="h-40 rounded-xl" />
      <Skeleton className="h-72 rounded-xl" />
    </div>
  );
}

export default function AdminMemberPage({ params }: PageProps<"/admin/members/[userId]">) {
  return (
    <main>
      <Suspense fallback={<MemberDetailSkeleton />}>
        <MemberDetailView params={params} />
      </Suspense>
    </main>
  );
}
