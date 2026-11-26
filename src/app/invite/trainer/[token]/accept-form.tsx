"use client";

import { useActionState } from "react";
import { FormAlert } from "@/components/form-alert";
import { SubmitButton } from "@/components/submit-button";
import { TextLink } from "@/components/text-link";
import { acceptInviteAction, type AcceptFormState } from "./actions";

export function AcceptInviteForm({ token }: { token: string }) {
  const [state, action, pending] = useActionState<AcceptFormState, FormData>(acceptInviteAction, { status: "idle" });

  const accepted = state.status === "accepted";

  return (
    <div className="flex flex-col gap-4">
      <FormAlert tone={accepted ? "success" : "error"}>
        {accepted ? "You're now a FitGate trainer." : state.status === "error" ? state.message : null}
      </FormAlert>
      {accepted ? (
        <TextLink href="/account" className="self-center text-sm">
          Go to your account
        </TextLink>
      ) : (
        <form action={action} className="flex flex-col gap-4">
          <input type="hidden" name="token" value={token} />
          <SubmitButton pending={pending} size="lg">{pending ? "Accepting…" : "Accept invite"}</SubmitButton>
        </form>
      )}
    </div>
  );
}
