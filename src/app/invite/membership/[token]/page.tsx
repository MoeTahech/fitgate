import type { Metadata } from "next";
import { io } from "next/cache";
import Link from "next/link";
import { Suspense } from "react";
import { CenteredCard, CenteredPage } from "@/components/centered-card";
import { SignOutButton } from "@/components/sign-out-button";
import { TextLink } from "@/components/text-link";
import { buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { authPageHref } from "@/lib/auth/redirect";
import { getSessionUser } from "@/lib/auth/session";
import { findMembershipInviteByToken } from "@/lib/services/memberships/invites";
import { AcceptInviteForm } from "./accept-form";

export const metadata: Metadata = { title: "Membership invite", referrer: "no-referrer", robots: { index: false } };

const UNUSABLE = {
  expired: { title: "This invite has expired", body: "Ask the person who invited you to send a new invite." },
  revoked: { title: "This invite was withdrawn", body: "Ask the person who invited you if you think this is a mistake." },
  accepted: { title: "This invite has been used", body: "If you accepted it, the membership is already on your account." },
  ended: { title: "This membership has ended", body: "The invite can no longer be used." },
  not_found: { title: "Invite not found", body: "Check that you opened the full link from your email." },
} as const;

async function InviteView({ params }: { params: PageProps<"/invite/membership/[token]">["params"] }) {
  const { token } = await params;
  await io();
  const invite = await findMembershipInviteByToken(token);

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

  const returnTo = `/invite/membership/${token}`;
  const user = await getSessionUser();
  const description = (
    <>
      {invite.inviterName} invited <span className="font-medium text-foreground">{invite.email}</span> to
      share their {invite.planName} membership.
    </>
  );

  if (!user) {
    return (
      <CenteredCard title="You're invited to share a membership" description={description}>
        <div className="flex flex-col gap-3">
          <Link
            href={authPageHref("/sign-in", returnTo, invite.email)}
            className={buttonVariants({ size: "lg" })}
          >
            Sign in to accept
          </Link>
          <Link
            href={authPageHref("/sign-up", returnTo, invite.email)}
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
          redirectTo={authPageHref("/sign-in", returnTo, invite.email)}
          size="lg"
          fullWidth
        />
      </CenteredCard>
    );
  }

  return (
    <CenteredCard title="Join the shared membership" description={description}>
      <AcceptInviteForm token={token} planName={invite.planName} />
    </CenteredCard>
  );
}

export default function MembershipInvitePage({ params }: PageProps<"/invite/membership/[token]">) {
  return (
    <CenteredPage>
      <Suspense fallback={<Skeleton className="h-64 w-full max-w-sm rounded-xl" />}>
        <InviteView params={params} />
      </Suspense>
    </CenteredPage>
  );
}
