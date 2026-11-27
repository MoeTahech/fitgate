import type { Metadata } from "next";
import { Suspense } from "react";
import { PageHeader } from "@/components/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { MembersList } from "./members-list";

export const metadata: Metadata = { title: "Members" };

export default function AdminMembersPage({ searchParams }: PageProps<"/admin/members">) {
  return (
    <main>
      <PageHeader title="Members" description="Find a member to record a payment or manage their membership." />
      <Suspense fallback={<Skeleton className="h-64 rounded-xl" />}>
        <MembersList searchParams={searchParams} />
      </Suspense>
    </main>
  );
}
