import type { Metadata } from "next";
import { io } from "next/cache";
import Link from "next/link";
import { Suspense } from "react";
import { CenteredCard, CenteredPage } from "@/components/centered-card";
import { SignOutButton } from "@/components/sign-out-button";
import { TextLink } from "@/components/text-link";
import { buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
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
  await io();
  const invite = await findInviteByToken(token);

  if (invite.state !== "valid") {
    const copy = UNUSABLE[invite.state];
    return (
      <CenteredCard title={copy.title} description={copy.body}>
        <TextLink href="/" className="text-sm">
          Back to FitGate
        </TextLink>
      </CenteredCard>
    );
  }

  const returnTo = `/invite/trainer/${token}`;
  const user = await getSessionUser();
  const description = (
    <>
      This invite is for <span className="font-medium text-foreground">{invite.email}</span>.
    </>
  );

  if (!user) {
    return (
      <CenteredCard title="You're invited to join as a trainer" description={description}>
        <div className="flex flex-col gap-3">
          <Link
            href={`/sign-in?next=${encodeURIComponent(returnTo)}`}
            className={buttonVariants({ size: "lg" })}
          >
            Sign in to accept
          </Link>
          <Link
            href={`/sign-up?next=${encodeURIComponent(returnTo)}`}
            className={buttonVariants({ variant: "outline", size: "lg" })}
          >
            Create an account
          </Link>
          <p className="text-sm text-muted-foreground">Use {invite.email} so the invite can be matched to your account.</p>
        </div>
      </CenteredCard>
    );
  }

  if (user.email !== invite.email) {
    return (
      <CenteredCard
        title="Wrong account"
        description={
          <>
            You&apos;re signed in as {user.email}, but this invite is for {invite.email}. Sign out and continue with the invited
            address.
          </>
        }
      >
        <SignOutButton
          redirectTo={`/sign-in?next=${encodeURIComponent(returnTo)}`}
          size="lg"
          fullWidth
        />
      </CenteredCard>
    );
  }

  return (
    <CenteredCard title="Accept your trainer invite" description={description}>
      <AcceptInviteForm token={token} />
    </CenteredCard>
  );
}

export default function TrainerInvitePage({ params }: PageProps<"/invite/trainer/[token]">) {
  return (
    <CenteredPage>
      <Suspense fallback={<Skeleton className="h-64 w-full max-w-sm rounded-xl" />}>
        <InviteView params={params} />
      </Suspense>
    </CenteredPage>
  );
}
