"use client";

import { useState } from "react";
import { FormAlert } from "@/components/ui/form";
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
      {status ? <FormAlert tone={status.tone}>{status.message}</FormAlert> : null}
      <button
        type="button"
        onClick={resend}
        disabled={pending}
        className="h-10 rounded-md border border-zinc-300 px-4 text-sm font-medium text-zinc-800 transition hover:bg-zinc-100 disabled:opacity-60 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-900"
      >
        {pending ? "Sending…" : "Resend verification email"}
      </button>
    </div>
  );
}

