import type { Metadata } from "next";
import { Suspense } from "react";
import { PageHeader } from "@/components/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { PaymentsList } from "./payments-list";

export const metadata: Metadata = { title: "Payments" };

export default function AdminPaymentsPage({ searchParams }: PageProps<"/admin/payments">) {
  return (
    <main>
      <PageHeader title="Payments" description="Every recorded payment, with totals for the filtered range." />
      <Suspense fallback={<Skeleton className="h-64 rounded-xl" />}>
        <PaymentsList searchParams={searchParams} />
      </Suspense>
    </main>
  );
}
