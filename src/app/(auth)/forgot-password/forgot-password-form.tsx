"use client";

import { useState, type FormEvent } from "react";
import { CenteredCard } from "@/components/centered-card";
import { FormAlert } from "@/components/form-alert";
import { InputField } from "@/components/form-field";
import { SubmitButton } from "@/components/submit-button";
import { TextLink } from "@/components/text-link";
import { authClient } from "@/lib/auth/client";
import { describeAuthError } from "@/lib/auth/client-errors";
import { emailOnlySchema, fieldErrors } from "@/lib/auth/schemas";
import { showFieldErrors } from "@/lib/forms/field-errors";

export function ForgotPasswordForm() {
  const [error, setError] = useState<string | undefined>();
  const [formError, setFormError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    const parsed = emailOnlySchema.safeParse(Object.fromEntries(new FormData(event.currentTarget)));
    if (!parsed.success) {
      showFieldErrors(event.currentTarget, fieldErrors(parsed.error), (errors) => setError(errors.email));
      return;
    }
    setError(undefined);
    setPending(true);
    const { error: requestError } = await authClient.requestPasswordReset({
      email: parsed.data.email,
      redirectTo: "/reset-password",
    });
    setPending(false);
    if (requestError) {
      setFormError(describeAuthError(requestError));
      return;
    }
    setSent(true);
  }

  return (
    <CenteredCard
      title="Reset your password"
      description="Enter the email you signed up with and we'll send you a reset link."
      footer={<TextLink href="/sign-in">Back to sign in</TextLink>}
    >
      <div className="flex flex-col gap-4">
        <FormAlert tone={sent ? "success" : "error"}>
          {sent ? "If an account exists for that email, a reset link is on its way. It expires in 1 hour." : formError}
        </FormAlert>
        {sent ? null : (
          <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
            <InputField id="email" name="email" type="email" label="Email" autoComplete="email" required error={error} />
            <SubmitButton pending={pending} size="lg">{pending ? "Sending…" : "Send reset link"}</SubmitButton>
          </form>
        )}
      </div>
    </CenteredCard>
  );
}
