"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState, type FormEvent } from "react";
import { CenteredCard } from "@/components/centered-card";
import { FormAlert } from "@/components/form-alert";
import { InputField } from "@/components/form-field";
import { SubmitButton } from "@/components/submit-button";
import { TextLink } from "@/components/text-link";
import { buttonVariants } from "@/components/ui/button";
import { authClient } from "@/lib/auth/client";
import { describeAuthError } from "@/lib/auth/client-errors";
import { safeRedirectPath, verificationCallbackURL } from "@/lib/auth/redirect";
import { emailOnlySchema, fieldErrors } from "@/lib/auth/schemas";
import { showFieldErrors } from "@/lib/forms/field-errors";

export function VerifyEmailView() {
  const params = useSearchParams();
  const next = safeRedirectPath(params.get("next"), "/account");
  const failed = params.has("error");
  const { data: session, isPending } = authClient.useSession();

  if (!failed && isPending) {
    return <CenteredCard title="Checking your email…">{null}</CenteredCard>;
  }

  if (!failed && session?.user.emailVerified) {
    return (
      <CenteredCard title="Email verified" description="Your email address is confirmed and you're signed in.">
        <Link
          href={next}
          className={buttonVariants({ size: "lg" })}
        >
          Continue
        </Link>
      </CenteredCard>
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
      showFieldErrors(event.currentTarget, fieldErrors(parsed.error), (errors) => setError(errors.email));
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
    <CenteredCard
      title={failed ? "This link has expired" : "Verify your email"}
      description={
        failed
          ? "The verification link is invalid or has expired. Enter your email to get a new one."
          : "Follow the link we emailed you. Didn't get it? Enter your email to send a new one."
      }
      footer={<TextLink href={`/sign-in?next=${encodeURIComponent(next)}`}>Back to sign in</TextLink>}
    >
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        <FormAlert tone={status?.tone ?? "success"}>{status?.message}</FormAlert>
        <InputField id="email" name="email" type="email" label="Email" autoComplete="email" required error={error} />
        <SubmitButton pending={pending} size="lg">{pending ? "Sending…" : "Send verification link"}</SubmitButton>
      </form>
    </CenteredCard>
  );
}
