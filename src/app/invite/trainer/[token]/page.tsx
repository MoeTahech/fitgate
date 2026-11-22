import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { SignOutButton } from "@/components/sign-out-button";
import { AuthCard } from "@/components/ui/form";
import { getSessionUser } from "@/lib/auth/session";
import { findInviteByToken } from "@/lib/services/trainer-invites";
import { AcceptInviteForm } from "./accept-form";

export const metadata: Metadata = { title: "Trainer invite", referrer: "no-referrer", robots: { index: false } };

const UNUSABLE = {
  expired: { title: "This invite has expired", body: "Ask a FitGate admin to send you a new invite." },
  revoked: { title: "This invite was withdrawn", body: "Ask a FitGate admin if you think this is a mistake." },
  accepted: { title: "This invite has been used", body: "If you accepted it, your account already has trainer access." },
  not_found: { title: "Invite not found", body: "Check that you opened the full link from your email." },
} as const;

async function InviteView({ params }: { params: PageProps<"/invite/trainer/[token]">["params"] }) {
  const { token } = await params;
  const invite = await findInviteByToken(token);

  if (invite.state !== "valid") {
    const copy = UNUSABLE[invite.state];
    return (
      <AuthCard title={copy.title} description={copy.body}>
        <Link href="/" className="text-sm font-medium underline">
          Back to FitGate
        </Link>
      </AuthCard>
    );
  }

  const returnTo = `/invite/trainer/${token}`;
  const user = await getSessionUser();
  const description = (
    <>
      This invite is for <span className="font-medium text-zinc-900 dark:text-zinc-100">{invite.email}</span>.
    </>
  );

  if (!user) {
    return (
      <AuthCard title="You're invited to join as a trainer" description={description}>
        <div className="flex flex-col gap-3">
          <Link
            href={`/sign-in?next=${encodeURIComponent(returnTo)}`}
            className="flex h-11 items-center justify-center rounded-md bg-zinc-900 px-4 font-medium text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900"
          >
            Sign in to accept
          </Link>
          <Link
            href={`/sign-up?next=${encodeURIComponent(returnTo)}`}
            className="flex h-11 items-center justify-center rounded-md border border-zinc-300 px-4 font-medium dark:border-zinc-700"
          >
            Create an account
          </Link>
          <p className="text-sm text-zinc-500">Use {invite.email} so the invite can be matched to your account.</p>
        </div>
      </AuthCard>
    );
  }

  if (user.email !== invite.email) {
    return (
      <AuthCard
        title="Wrong account"
        description={
          <>
            You&apos;re signed in as {user.email}, but this invite is for {invite.email}. Sign out and continue with the invited
            address.
          </>
        }
      >
        <SignOutButton className="h-11 w-full rounded-md border border-zinc-300 px-4 font-medium dark:border-zinc-700" />
      </AuthCard>
    );
  }

  return (
    <AuthCard title="Accept your trainer invite" description={description}>
      <AcceptInviteForm token={token} />
    </AuthCard>
  );
}

export default function TrainerInvitePage({ params }: PageProps<"/invite/trainer/[token]">) {
  return (
    <main className="flex flex-1 items-start justify-center px-4 py-12 sm:items-center">
      <Suspense fallback={<div className="h-64 w-full max-w-sm animate-pulse rounded-xl bg-zinc-100 dark:bg-zinc-900" />}>
        <InviteView params={params} />
      </Suspense>
    </main>
  );
}
