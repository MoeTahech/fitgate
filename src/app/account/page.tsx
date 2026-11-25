import type { Metadata } from "next";
import { Suspense } from "react";
import { SignOutButton } from "@/components/sign-out-button";
import { requirePageUser } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Account" };

const ROLE_LABELS = { MEMBER: "Member", TRAINER: "Trainer", ADMIN: "Admin" } as const;

async function AccountDetails() {
  const user = await requirePageUser("/account");
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-950">
      <dl className="grid gap-4 text-sm sm:grid-cols-[8rem_1fr]">
        <dt className="text-zinc-500">Name</dt>
        <dd className="font-medium text-zinc-900 dark:text-zinc-100">{user.name}</dd>
        <dt className="text-zinc-500">Email</dt>
        <dd className="font-medium text-zinc-900 dark:text-zinc-100">{user.email}</dd>
        <dt className="text-zinc-500">Role</dt>
        <dd className="font-medium text-zinc-900 dark:text-zinc-100">{ROLE_LABELS[user.role]}</dd>
      </dl>
      <div className="mt-6">
        <SignOutButton />
      </div>
    </div>
  );
}

export default function AccountPage() {
  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-10">
      <h1 className="mb-6 text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">Your account</h1>
      <Suspense fallback={<div className="h-48 animate-pulse rounded-xl bg-zinc-100 dark:bg-zinc-900" />}>
        <AccountDetails />
      </Suspense>
    </main>
  );
}
