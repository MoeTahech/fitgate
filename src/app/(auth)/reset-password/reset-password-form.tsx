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
import { describeAuthError, isRateLimited } from "@/lib/auth/client-errors";
import { fieldErrors, newPasswordSchema, PASSWORD_MIN_LENGTH } from "@/lib/auth/schemas";
import { showFieldErrors } from "@/lib/forms/field-errors";

const LINK_INVALID = "This reset link is invalid or has expired.";

export function ResetPasswordForm() {
  const params = useSearchParams();
  const token = params.get("token");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(params.has("error") || !token ? LINK_INVALID : null);
  const [done, setDone] = useState(false);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token) return;
    setFormError(null);
    const parsed = newPasswordSchema.safeParse(Object.fromEntries(new FormData(event.currentTarget)));
    if (!parsed.success) {
      showFieldErrors(event.currentTarget, fieldErrors(parsed.error), setErrors);
      return;
    }
    setErrors({});
    setPending(true);
    const { error } = await authClient.resetPassword({ newPassword: parsed.data.password, token });
    setPending(false);
    if (error) {
      setFormError(isRateLimited(error) ? describeAuthError(error) : LINK_INVALID);
      return;
    }
    setDone(true);
  }

  const linkUnusable = !token || params.has("error");

  return (
    <CenteredCard
      title={done ? "Password updated" : "Choose a new password"}
      footer={done ? undefined : <TextLink href="/forgot-password">Request a new link</TextLink>}
    >
      <div className="flex flex-col gap-4">
        <FormAlert tone={done ? "success" : "error"}>
          {done ? "Your password has been changed and you've been signed out on all devices." : formError}
        </FormAlert>
        {done ? (
          <Link href="/sign-in" className={buttonVariants({ size: "lg", className: "w-full" })}>
            Sign in
          </Link>
        ) : linkUnusable ? null : (
          <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
            <InputField
              id="password"
              name="password"
              type="password"
              label="New password"
              autoComplete="new-password"
              required
              minLength={PASSWORD_MIN_LENGTH}
              hint={`At least ${PASSWORD_MIN_LENGTH} characters.`}
              error={errors.password}
            />
            <InputField
              id="confirmPassword"
              name="confirmPassword"
              type="password"
              label="Confirm new password"
              autoComplete="new-password"
              required
              error={errors.confirmPassword}
            />
            <SubmitButton pending={pending} size="lg">{pending ? "Saving…" : "Update password"}</SubmitButton>
          </form>
        )}
      </div>
    </CenteredCard>
  );
}
