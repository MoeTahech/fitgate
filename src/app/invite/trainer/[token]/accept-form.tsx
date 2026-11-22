"use client";

import Link from "next/link";
import { useActionState } from "react";
import { FormAlert, SubmitButton } from "@/components/ui/form";
import { acceptInviteAction, type AcceptFormState } from "./actions";

export function AcceptInviteForm({ token }: { token: string }) {
  const [state, action, pending] = useActionState<AcceptFormState, FormData>(acceptInviteAction, { status: "idle" });

  if (state.status === "accepted") {
    return (
      <div className="flex flex-col gap-4">
        <FormAlert tone="success">You&apos;re now a FitGate trainer.</FormAlert>
        <Link href="/account" className="text-center text-sm font-medium underline">
          Go to your account
        </Link>
      </div>
    );
  }

  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="token" value={token} />
      {state.status === "error" ? <FormAlert tone="error">{state.message}</FormAlert> : null}
      <SubmitButton pending={pending}>{pending ? "Accepting…" : "Accept invite"}</SubmitButton>
    </form>
  );
}
