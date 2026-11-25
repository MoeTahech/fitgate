"use client";

import { useSearchParams } from "next/navigation";
import { useState, type FormEvent } from "react";
import { CenteredCard } from "@/components/centered-card";
import { FormAlert } from "@/components/form-alert";
import { InputField } from "@/components/form-field";
import { SubmitButton } from "@/components/submit-button";
import { TextLink } from "@/components/text-link";
import { authClient } from "@/lib/auth/client";
import { describeAuthError } from "@/lib/auth/client-errors";
import { hardNavigate } from "@/lib/auth/navigation";
import { safeRedirectPath, verificationCallbackURL } from "@/lib/auth/redirect";
import { fieldErrors, signInSchema } from "@/lib/auth/schemas";
import { ResendVerification } from "../resend-verification";

const INVALID_CREDENTIALS = "Incorrect email or password.";

export function SignInForm() {
  const next = safeRedirectPath(useSearchParams().get("next"), "/account");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [unverifiedEmail, setUnverifiedEmail] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    setUnverifiedEmail(null);
    const parsed = signInSchema.safeParse(Object.fromEntries(new FormData(event.currentTarget)));
    if (!parsed.success) {
      setErrors(fieldErrors(parsed.error));
      return;
    }
    setErrors({});
    setPending(true);
    const { error } = await authClient.signIn.email(parsed.data);
    if (error) {
      setPending(false);
      if (error.status === 403) {
        setUnverifiedEmail(parsed.data.email);
        return;
      }
      setFormError(describeAuthError(error, INVALID_CREDENTIALS));
      return;
    }
    hardNavigate(next);
  }

  return (
    <CenteredCard
      title="Sign in"
      footer={
        <>
          New to FitGate?{" "}
          <TextLink href={`/sign-up?next=${encodeURIComponent(next)}`}>
            Create an account
          </TextLink>
        </>
      }
    >
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        {formError ? <FormAlert tone="error">{formError}</FormAlert> : null}
        {unverifiedEmail ? (
          <div className="flex flex-col gap-3">
            <FormAlert tone="info">
              Please verify your email address first. We&apos;ve sent a new link to your inbox.
            </FormAlert>
            <ResendVerification email={unverifiedEmail} callbackURL={verificationCallbackURL(next)} />
          </div>
        ) : null}
        <InputField id="email" name="email" type="email" label="Email" autoComplete="email" required error={errors.email} />
        <div className="flex flex-col gap-1.5">
          <InputField
            id="password"
            name="password"
            type="password"
            label="Password"
            autoComplete="current-password"
            required
            error={errors.password}
          />
          <TextLink href="/forgot-password" className="self-end text-sm font-normal">
            Forgot password?
          </TextLink>
        </div>
        <SubmitButton pending={pending} size="lg">{pending ? "Signing in…" : "Sign in"}</SubmitButton>
      </form>
    </CenteredCard>
  );
}
