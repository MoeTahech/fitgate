"use client";

import {
  createContext,
  startTransition,
  use,
  useActionState,
  useOptimistic,
  useRef,
  type ReactNode,
  type RefObject,
} from "react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { FormAlert } from "@/components/form-alert";
import { FormField } from "@/components/form-field";
import { SubmitButton } from "@/components/submit-button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  createInviteAction,
  resendInviteAction,
  revokeInviteAction,
  type InviteFormState,
} from "./actions";
import { describeInviteResult, type InviteResult, type InviteTarget } from "./invite-results";

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
      <FormAlert tone={state.status === "error" ? "error" : "success"}>{state.message}</FormAlert>
    </form>
  );
}

type InviteActionsContextValue = {
  run: (target: InviteTarget) => void;
  pending: InviteTarget | null;
  result: InviteResult;
  resultsRef: RefObject<HTMLDivElement | null>;
};

const InviteActionsContext = createContext<InviteActionsContextValue | null>(null);

function useInviteActions(): InviteActionsContextValue {
  const value = use(InviteActionsContext);
  if (!value) throw new Error("Invite actions must be rendered inside <InviteActionsProvider>");
  return value;
}

async function runInviteAction(_previous: InviteResult, target: InviteTarget): Promise<InviteResult> {
  const formData = new FormData();
  formData.set("inviteId", target.inviteId);
  const action = target.intent === "revoke" ? revokeInviteAction : resendInviteAction;
  const state = await action(IDLE, formData);
  return { ...state, intent: target.intent, email: target.email };
}

/**
 * Owns the row actions' state above the table, so results and the focus target survive the
 * refresh that removes a row's actions (e.g. after revoking).
 */
export function InviteActionsProvider({ children }: { children: ReactNode }) {
  const resultsRef = useRef<HTMLDivElement>(null);
  const [result, dispatch] = useActionState(runInviteAction, IDLE);
  const [pending, setPending] = useOptimistic<InviteTarget | null>(null);

  function run(target: InviteTarget) {
    startTransition(() => {
      setPending(target);
      dispatch(target);
    });
  }

  return <InviteActionsContext value={{ run, pending, result, resultsRef }}>{children}</InviteActionsContext>;
}

/** Result of the last invite row action; also the focus target after a confirmed revoke. */
export function InviteResults() {
  const { pending, result, resultsRef } = useInviteActions();
  const message = describeInviteResult(result, pending);
  return (
    <div ref={resultsRef} tabIndex={-1} className={cn("outline-none", message && "mb-3")}>
      <FormAlert tone={message?.tone ?? "info"}>{message?.text}</FormAlert>
    </div>
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
  const { run, pending, resultsRef } = useInviteActions();
  const resending = pending?.inviteId === inviteId && pending.intent === "resend";
  const revoking = pending?.inviteId === inviteId && pending.intent === "revoke";
  return (
    <div className="flex gap-2">
      {canResend ? (
        <form action={() => run({ intent: "resend", inviteId, email })}>
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
          action={() => run({ intent: "revoke", inviteId, email })}
          pending={revoking}
          finalFocus={resultsRef}
        />
      ) : null}
    </div>
  );
}
