"use client";

import { useActionState } from "react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { FormAlert } from "@/components/form-alert";
import { FormField } from "@/components/form-field";
import { InlineStatus } from "@/components/inline-status";
import { SubmitButton } from "@/components/submit-button";
import { Input } from "@/components/ui/input";
import {
  createInviteAction,
  resendInviteAction,
  revokeInviteAction,
  type InviteFormState,
} from "./actions";

const IDLE: InviteFormState = { status: "idle" };

export function CreateInviteForm() {
  const [state, action, pending] = useActionState(createInviteAction, IDLE);
  return (
    <form action={action} className="flex flex-col gap-3">
      <FormField id="invite-email" label="Invite a trainer by email">
        {(control) => (
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input {...control} name="email" type="email" required maxLength={254} autoComplete="off" className="sm:flex-1" />
            <SubmitButton pending={pending}>{pending ? "Sending…" : "Send invite"}</SubmitButton>
          </div>
        )}
      </FormField>
      {state.message ? <FormAlert tone={state.status === "error" ? "error" : "success"}>{state.message}</FormAlert> : null}
    </form>
  );
}

export function InviteActions({
  inviteId,
  email,
  canRevoke,
  canResend,
}: {
  inviteId: string;
  email: string;
  canRevoke: boolean;
  canResend: boolean;
}) {
  const [revokeState, revoke, revoking] = useActionState(revokeInviteAction, IDLE);
  const [resendState, resend, resending] = useActionState(resendInviteAction, IDLE);
  const message = resendState.message ? resendState : revokeState;
  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex gap-2">
        {canResend ? (
          <form action={resend}>
            <input type="hidden" name="inviteId" value={inviteId} />
            <SubmitButton pending={resending} variant="outline" size="sm">
              {resending ? "Sending…" : "Resend"}
            </SubmitButton>
          </form>
        ) : null}
        {canRevoke ? (
          <ConfirmDialog
            triggerLabel="Revoke"
            pendingLabel="Revoking…"
            triggerSize="sm"
            title="Revoke this invite?"
            description={`The link sent to ${email} will stop working. You can send a new invite later.`}
            confirmLabel="Revoke invite"
            tone="destructive"
            action={revoke}
            pending={revoking}
          >
            <input type="hidden" name="inviteId" value={inviteId} />
          </ConfirmDialog>
        ) : null}
      </div>
      {message.message ? <InlineStatus tone={message.status === "error" ? "error" : "success"}>{message.message}</InlineStatus> : null}
    </div>
  );
}
