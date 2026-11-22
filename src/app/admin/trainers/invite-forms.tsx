"use client";

import { useActionState } from "react";
import {
  createInviteAction,
  resendInviteAction,
  revokeInviteAction,
  type InviteFormState,
} from "./actions";

const IDLE: InviteFormState = { status: "idle" };

function StatusMessage({ state }: { state: InviteFormState }) {
  if (!state.message) return null;
  return (
    <p
      role={state.status === "error" ? "alert" : "status"}
      className={`text-sm ${state.status === "error" ? "text-red-700 dark:text-red-400" : "text-emerald-700 dark:text-emerald-400"}`}
    >
      {state.message}
    </p>
  );
}

export function CreateInviteForm() {
  const [state, action, pending] = useActionState(createInviteAction, IDLE);
  return (
    <form action={action} className="flex flex-col gap-2">
      <label htmlFor="invite-email" className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
        Invite a trainer by email
      </label>
      <div className="flex gap-2">
        <input
          id="invite-email"
          name="email"
          type="email"
          required
          maxLength={254}
          autoComplete="off"
          className="h-10 flex-1 rounded-md border border-zinc-300 bg-white px-3 text-sm dark:border-zinc-700 dark:bg-zinc-900"
        />
        <button
          type="submit"
          disabled={pending}
          className="h-10 rounded-md bg-zinc-900 px-4 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900"
        >
          {pending ? "Sending…" : "Send invite"}
        </button>
      </div>
      <StatusMessage state={state} />
    </form>
  );
}

const SECONDARY_BUTTON =
  "h-8 rounded-md border border-zinc-300 px-3 text-xs font-medium hover:bg-zinc-100 disabled:opacity-60 dark:border-zinc-700 dark:hover:bg-zinc-900";

export function InviteActions({ inviteId, canRevoke, canResend }: { inviteId: string; canRevoke: boolean; canResend: boolean }) {
  const [revokeState, revoke, revoking] = useActionState(revokeInviteAction, IDLE);
  const [resendState, resend, resending] = useActionState(resendInviteAction, IDLE);
  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex gap-2">
        {canResend ? (
          <form action={resend}>
            <input type="hidden" name="inviteId" value={inviteId} />
            <button type="submit" disabled={resending} className={SECONDARY_BUTTON}>
              {resending ? "Sending…" : "Resend"}
            </button>
          </form>
        ) : null}
        {canRevoke ? (
          <form action={revoke}>
            <input type="hidden" name="inviteId" value={inviteId} />
            <button type="submit" disabled={revoking} className={`${SECONDARY_BUTTON} text-red-700 dark:text-red-400`}>
              {revoking ? "Revoking…" : "Revoke"}
            </button>
          </form>
        ) : null}
      </div>
      <StatusMessage state={resendState.message ? resendState : revokeState} />
    </div>
  );
}
