import type { Metadata } from "next";
import { Suspense } from "react";
import { PageHeader, SectionHeader } from "@/components/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { MembershipsList } from "./memberships-list";
import { PendingFreezes } from "./pending-freezes";

export const metadata: Metadata = { title: "Memberships" };

export default function AdminMembershipsPage({ searchParams }: PageProps<"/admin/memberships">) {
  return (
    <main className="flex flex-col gap-8">
      <PageHeader title="Memberships" description="Decide freeze requests and find any membership." />
      <section>
        <SectionHeader title="Pending freezes" description="Approve or reject each request before it starts." />
        <Suspense fallback={<Skeleton className="h-32 rounded-xl" />}>
          <PendingFreezes />
        </Suspense>
      </section>
      <section>
        <SectionHeader title="All memberships" />
        <Suspense fallback={<Skeleton className="h-64 rounded-xl" />}>
          <MembershipsList searchParams={searchParams} />
        </Suspense>
      </section>
    </main>
  );
}
