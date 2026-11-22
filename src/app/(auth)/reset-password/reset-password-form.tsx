"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState, type FormEvent } from "react";
import { AuthCard, Field, FormAlert, SubmitButton } from "@/components/ui/form";
import { authClient } from "@/lib/auth/client";
import { describeAuthError, isRateLimited } from "@/lib/auth/client-errors";
import { fieldErrors, newPasswordSchema, PASSWORD_MIN_LENGTH } from "@/lib/auth/schemas";

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
      setErrors(fieldErrors(parsed.error));
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

  if (done) {
    return (
      <AuthCard
        title="Password updated"
        description="Your password has been changed and you've been signed out on all devices."
      >
        <Link
          href="/sign-in"
          className="flex h-11 items-center justify-center rounded-md bg-zinc-900 px-4 font-medium text-white transition hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
        >
          Sign in
        </Link>
      </AuthCard>
    );
  }

  const linkUnusable = !token || params.has("error");

  return (
    <AuthCard
      title="Choose a new password"
      footer={<Link href="/forgot-password" className="font-medium underline">Request a new link</Link>}
    >
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        {formError ? <FormAlert tone="error">{formError}</FormAlert> : null}
        {linkUnusable ? null : (
          <>
            <Field
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
            <Field
              id="confirmPassword"
              name="confirmPassword"
              type="password"
              label="Confirm new password"
              autoComplete="new-password"
              required
              error={errors.confirmPassword}
            />
            <SubmitButton pending={pending}>{pending ? "Saving…" : "Update password"}</SubmitButton>
          </>
        )}
      </form>
    </AuthCard>
  );
}
