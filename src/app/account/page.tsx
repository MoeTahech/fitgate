import type { Metadata } from "next";
import { Suspense } from "react";
import { PageContainer } from "@/components/page-container";
import { PageHeader } from "@/components/page-header";
import { SignOutButton } from "@/components/sign-out-button";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ROLE_LABELS } from "@/lib/auth/constants";
import { requirePageUser } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Account" };

async function AccountDetails() {
  const user = await requirePageUser("/account");
  return (
    <Card>
      <CardContent>
        <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-[8rem_1fr]">
          <dt className="text-muted-foreground">Name</dt>
          <dd className="font-medium">{user.name}</dd>
          <dt className="text-muted-foreground">Email</dt>
          <dd className="font-medium break-all">{user.email}</dd>
          <dt className="text-muted-foreground">Role</dt>
          <dd className="font-medium">{ROLE_LABELS[user.role]}</dd>
        </dl>
      </CardContent>
      <CardFooter>
        <SignOutButton />
      </CardFooter>
    </Card>
  );
}

export default function AccountPage() {
  return (
    <PageContainer width="narrow">
      <PageHeader title="Your account" />
      <Suspense fallback={<Skeleton className="h-56 rounded-xl" />}>
        <AccountDetails />
      </Suspense>
    </PageContainer>
  );
}
