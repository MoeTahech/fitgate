"use client";

import { useActionState } from "react";
import { FormAlert } from "@/components/form-alert";
import { SubmitButton } from "@/components/submit-button";
import { TextLink } from "@/components/text-link";
import { acceptInviteAction, type AcceptFormState } from "./actions";

export function AcceptInviteForm({ token, planName }: { token: string; planName: string }) {
  const [state, action, pending] = useActionState<AcceptFormState, FormData>(acceptInviteAction, { status: "idle" });

  const accepted = state.status === "accepted";

  return (
    <div className="flex flex-col gap-4">
      <FormAlert tone={accepted ? "success" : "error"}>
        {accepted ? `You've joined the ${planName} membership.` : state.status === "error" ? state.message : null}
      </FormAlert>
      {accepted ? (
        <TextLink href="/account/membership" className="self-center text-sm">
          View your membership
        </TextLink>
      ) : (
        <form action={action} className="flex flex-col gap-4">
          <input type="hidden" name="token" value={token} />
          <SubmitButton pending={pending} size="lg">{pending ? "Joining…" : "Join membership"}</SubmitButton>
        </form>
      )}
    </div>
  );
}
