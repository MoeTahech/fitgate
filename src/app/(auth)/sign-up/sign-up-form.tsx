"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState, type FormEvent } from "react";
import { AuthCard, Field, FormAlert, SubmitButton } from "@/components/ui/form";
import { authClient } from "@/lib/auth/client";
import { describeAuthError } from "@/lib/auth/client-errors";
import { safeRedirectPath, verificationCallbackURL } from "@/lib/auth/redirect";
import { fieldErrors, PASSWORD_MIN_LENGTH, signUpSchema } from "@/lib/auth/schemas";
import { ResendVerification } from "../resend-verification";

export function SignUpForm() {
  const next = safeRedirectPath(useSearchParams().get("next"), "/account");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [submittedEmail, setSubmittedEmail] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    const parsed = signUpSchema.safeParse(Object.fromEntries(new FormData(event.currentTarget)));
    if (!parsed.success) {
      setErrors(fieldErrors(parsed.error));
      return;
    }
    setErrors({});
    setPending(true);
    const { error } = await authClient.signUp.email({ ...parsed.data, callbackURL: verificationCallbackURL(next) });
    setPending(false);
    if (error) {
      setFormError(describeAuthError(error, "We couldn't create your account. Check your details and try again."));
      return;
    }
    setSubmittedEmail(parsed.data.email);
  }

  if (submittedEmail) {
    return (
      <AuthCard
        title="Check your email"
        description={
          <>
            We sent a message to <span className="font-medium text-zinc-900 dark:text-zinc-100">{submittedEmail}</span>.
            Follow the link in it to continue. The link expires in 1 hour.
          </>
        }
        footer={<Link href={`/sign-in?next=${encodeURIComponent(next)}`} className="font-medium underline">Back to sign in</Link>}
      >
        <ResendVerification email={submittedEmail} callbackURL={verificationCallbackURL(next)} />
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title="Create your account"
      description="Join FitGate to manage your membership and book classes."
      footer={
        <>
          Already have an account?{" "}
          <Link href={`/sign-in?next=${encodeURIComponent(next)}`} className="font-medium text-zinc-900 underline dark:text-zinc-100">
            Sign in
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        {formError ? <FormAlert tone="error">{formError}</FormAlert> : null}
        <Field id="name" name="name" label="Name" autoComplete="name" required error={errors.name} />
        <Field id="email" name="email" type="email" label="Email" autoComplete="email" required error={errors.email} />
        <Field
          id="password"
          name="password"
          type="password"
          label="Password"
          autoComplete="new-password"
          required
          minLength={PASSWORD_MIN_LENGTH}
          hint={`At least ${PASSWORD_MIN_LENGTH} characters.`}
          error={errors.password}
        />
        <SubmitButton pending={pending}>{pending ? "Creating account…" : "Create account"}</SubmitButton>
      </form>
    </AuthCard>
  );
}
