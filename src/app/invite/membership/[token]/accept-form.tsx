"use client";

import { useActionState } from "react";
import { FormAlert } from "@/components/form-alert";
import { SubmitButton } from "@/components/submit-button";
import { TextLink } from "@/components/text-link";
import { acceptInviteAction, type AcceptFormState } from "./actions";

export function AcceptInviteForm({ token, planName }: { token: string; planName: string }) {
  const [state, action, pending] = useActionState<AcceptFormState, FormData>(acceptInviteAction, { status: "idle" });

  if (state.status === "accepted") {
    return (
      <div className="flex flex-col gap-4">
        <FormAlert tone="success">You&apos;ve joined the {planName} membership.</FormAlert>
        <TextLink href="/account" className="self-center text-sm">
          Go to your account
        </TextLink>
      </div>
    );
  }

  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="token" value={token} />
      {state.status === "error" ? <FormAlert tone="error">{state.message}</FormAlert> : null}
      <SubmitButton pending={pending} size="lg">{pending ? "Joining…" : "Join membership"}</SubmitButton>
    </form>
  );
}
