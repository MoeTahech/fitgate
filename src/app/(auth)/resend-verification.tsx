"use client";

import { useState } from "react";
import { FormAlert } from "@/components/form-alert";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth/client";
import { describeAuthError } from "@/lib/auth/client-errors";

type Status = { tone: "success" | "error"; message: string } | null;

export function ResendVerification({ email, callbackURL }: { email: string; callbackURL: string }) {
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState<Status>(null);

  async function resend() {
    setPending(true);
    setStatus(null);
    const { error } = await authClient.sendVerificationEmail({ email, callbackURL });
    setPending(false);
    setStatus(
      error
        ? { tone: "error", message: describeAuthError(error) }
        : { tone: "success", message: "If this address still needs verifying, a new link is on its way." },
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <FormAlert tone={status?.tone ?? "success"}>{status?.message}</FormAlert>
      <Button type="button" variant="outline" size="lg" onClick={resend} disabled={pending} aria-busy={pending || undefined}>
        {pending ? "Sending…" : "Resend verification email"}
      </Button>
    </div>
  );
}

