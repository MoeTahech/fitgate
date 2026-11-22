"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState, type FormEvent } from "react";
import { AuthCard, Field, FormAlert, SubmitButton } from "@/components/ui/form";
import { authClient } from "@/lib/auth/client";
import { describeAuthError } from "@/lib/auth/client-errors";
import { safeRedirectPath, verificationCallbackURL } from "@/lib/auth/redirect";
import { emailOnlySchema, fieldErrors } from "@/lib/auth/schemas";

export function VerifyEmailView() {
  const params = useSearchParams();
  const next = safeRedirectPath(params.get("next"), "/account");
  const failed = params.has("error");
  const { data: session, isPending } = authClient.useSession();

  if (!failed && isPending) {
    return <AuthCard title="Checking your email…">{null}</AuthCard>;
  }

  if (!failed && session?.user.emailVerified) {
    return (
      <AuthCard title="Email verified" description="Your email address is confirmed and you're signed in.">
        <Link
          href={next}
          className="flex h-11 items-center justify-center rounded-md bg-zinc-900 px-4 font-medium text-white transition hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
        >
          Continue
        </Link>
      </AuthCard>
    );
  }

  return <ResendForm next={next} failed={failed} />;
}

function ResendForm({ next, failed }: { next: string; failed: boolean }) {
  const [error, setError] = useState<string | undefined>();
  const [status, setStatus] = useState<{ tone: "success" | "error"; message: string } | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus(null);
    const parsed = emailOnlySchema.safeParse(Object.fromEntries(new FormData(event.currentTarget)));
    if (!parsed.success) {
      setError(fieldErrors(parsed.error).email);
      return;
    }
    setError(undefined);
    setPending(true);
    const { error: requestError } = await authClient.sendVerificationEmail({
      email: parsed.data.email,
      callbackURL: verificationCallbackURL(next),
    });
    setPending(false);
    setStatus(
      requestError
        ? { tone: "error", message: describeAuthError(requestError) }
        : { tone: "success", message: "If this address still needs verifying, a new link is on its way." },
    );
  }

  return (
    <AuthCard
      title={failed ? "This link has expired" : "Verify your email"}
      description={
        failed
          ? "The verification link is invalid or has expired. Enter your email to get a new one."
          : "Follow the link we emailed you. Didn't get it? Enter your email to send a new one."
      }
      footer={<Link href={`/sign-in?next=${encodeURIComponent(next)}`} className="font-medium underline">Back to sign in</Link>}
    >
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        {status ? <FormAlert tone={status.tone}>{status.message}</FormAlert> : null}
        <Field id="email" name="email" type="email" label="Email" autoComplete="email" required error={error} />
        <SubmitButton pending={pending}>{pending ? "Sending…" : "Send verification link"}</SubmitButton>
      </form>
    </AuthCard>
  );
}
