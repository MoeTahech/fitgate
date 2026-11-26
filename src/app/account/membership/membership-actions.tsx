"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent, type RefObject } from "react";
import { useActionResults, type RowAction } from "@/components/action-results";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { InputField } from "@/components/form-field";
import { SubmitButton } from "@/components/submit-button";
import { firstInvalidControl, showFieldErrors } from "@/lib/forms/field-errors";
import { freezeRequestFormSchema, inviteFormSchema, parseForm } from "@/lib/memberships-ui/forms";
import {
  cancelFreezeAction,
  createInviteAction,
  leaveMembershipAction,
  removePartnerAction,
  requestFreezeAction,
  resendInviteAction,
  revokeInviteAction,
  startTrialAction,
} from "./actions";

type Run = ReturnType<typeof useActionResults>["run"];

function submitTo(run: Run, key: string, pendingMessage: string, action: RowAction) {
  return (formData: FormData) => run({ key, pendingMessage, action, formData });
}

/**
 * Server field errors for this form's fields, from the last row action's result. The form's
 * submit goes through `run`, so a success or delivery message survives the refresh that removes
 * the form; only the errors that belong to a field are shown on it (and focused).
 */
function useFormErrors(form: RefObject<HTMLFormElement | null>, fields: readonly string[]) {
  const { result } = useActionResults();
  const [clientErrors, setClientErrors] = useState<Record<string, string>>({});

  const serverErrors = useMemo(() => {
    const errors = result.status === "error" ? (result.fieldErrors ?? {}) : {};
    return Object.fromEntries(Object.entries(errors).filter(([field]) => fields.includes(field)));
  }, [result, fields]);

  useEffect(() => {
    const controls = form.current ? Array.from(form.current.elements) : [];
    const named = controls.filter((control): control is HTMLInputElement => "name" in control && "focus" in control);
    firstInvalidControl(named, serverErrors)?.focus();
  }, [form, serverErrors]);

  const errors = Object.keys(clientErrors).length > 0 ? clientErrors : serverErrors;
  return { errors, setClientErrors };
}

// ─── Trials ──────────────────────────────────────────────────────────────────

export function StartTrialButton({
  kind,
  label,
  title,
  description,
}: {
  kind: "GYM" | "CLASS";
  label: string;
  title: string;
  description: string;
}) {
  const { run, pendingKey, resultsRef } = useActionResults();
  const key = `trial:${kind}`;
  return (
    <ConfirmDialog
      triggerLabel={label}
      pendingLabel="Starting…"
      triggerVariant="default"
      title={title}
      description={description}
      confirmLabel="Start trial"
      cancelLabel="Not now"
      action={submitTo(run, key, "Starting your trial…", startTrialAction)}
      pending={pendingKey === key}
      finalFocus={resultsRef}
    >
      <input type="hidden" name="kind" value={kind} />
    </ConfirmDialog>
  );
}

// ─── Couples: partner and invites ────────────────────────────────────────────

export function RemovePartnerButton({ seatId, name }: { seatId: string; name: string }) {
  const { run, pendingKey, resultsRef } = useActionResults();
  const key = `remove:${seatId}`;
  return (
    <ConfirmDialog
      triggerLabel="Remove"
      pendingLabel="Removing…"
      triggerSize="sm"
      title={`Remove ${name}?`}
      description={`${name} loses access right away. You can invite someone else.`}
      confirmLabel="Remove partner"
      tone="destructive"
      action={submitTo(run, key, "Removing your partner…", removePartnerAction)}
      pending={pendingKey === key}
      finalFocus={resultsRef}
    >
      <input type="hidden" name="seatId" value={seatId} />
    </ConfirmDialog>
  );
}

export function LeaveMembershipButton({ membershipId, planName, ownerName }: { membershipId: string; planName: string; ownerName: string }) {
  const { run, pendingKey, resultsRef } = useActionResults();
  const key = `leave:${membershipId}`;
  return (
    <ConfirmDialog
      triggerLabel="Leave membership"
      pendingLabel="Leaving…"
      title={`Leave ${planName}?`}
      description={`You lose access to ${planName} right away. ${ownerName} would have to invite you again.`}
      confirmLabel="Leave membership"
      tone="destructive"
      action={submitTo(run, key, "Leaving the membership…", leaveMembershipAction)}
      pending={pendingKey === key}
      finalFocus={resultsRef}
    >
      <input type="hidden" name="membershipId" value={membershipId} />
    </ConfirmDialog>
  );
}

export function InviteRowActions({ inviteId, email }: { inviteId: string; email: string }) {
  const { run, pendingKey, resultsRef } = useActionResults();
  const resendKey = `resend:${inviteId}`;
  const revokeKey = `revoke:${inviteId}`;
  const resending = pendingKey === resendKey;
  return (
    <div className="flex flex-wrap gap-2">
      <form action={submitTo(run, resendKey, "Sending the invite again…", resendInviteAction)}>
        <input type="hidden" name="inviteId" value={inviteId} />
        <SubmitButton pending={resending} variant="outline" size="sm">
          {resending ? "Sending…" : "Resend"}
        </SubmitButton>
      </form>
      <ConfirmDialog
        triggerLabel="Revoke"
        pendingLabel="Revoking…"
        triggerSize="sm"
        title="Withdraw this invite?"
        description={`The link sent to ${email} will stop working. You can send a new invite later.`}
        confirmLabel="Withdraw invite"
        tone="destructive"
        action={submitTo(run, revokeKey, "Withdrawing the invite…", revokeInviteAction)}
        pending={pendingKey === revokeKey}
        finalFocus={resultsRef}
      >
        <input type="hidden" name="inviteId" value={inviteId} />
      </ConfirmDialog>
    </div>
  );
}

const INVITE_FIELDS = ["email"] as const;

export function InviteForm({ membershipId }: { membershipId: string }) {
  const { run, pendingKey } = useActionResults();
  const formRef = useRef<HTMLFormElement>(null);
  const { errors, setClientErrors } = useFormErrors(formRef, INVITE_FIELDS);
  const pending = pendingKey === "invite";

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    const form = event.currentTarget;
    const parsed = parseForm(inviteFormSchema, new FormData(form));
    if (parsed.success) {
      setClientErrors({});
      return;
    }
    event.preventDefault();
    showFieldErrors(form, parsed.fieldErrors, setClientErrors);
  }

  return (
    <form
      ref={formRef}
      noValidate
      action={submitTo(run, "invite", "Sending the invite…", createInviteAction)}
      onSubmit={onSubmit}
      className="flex flex-col gap-3"
    >
      <input type="hidden" name="membershipId" value={membershipId} />
      <InputField
        id={`invite-email-${membershipId}`}
        name="email"
        type="email"
        label="Partner's email"
        hint="We'll email them a link to join this membership."
        error={errors.email}
        autoComplete="off"
        maxLength={254}
        required
      />
      <SubmitButton pending={pending} className="self-start">
        {pending ? "Sending…" : "Send invite"}
      </SubmitButton>
    </form>
  );
}

// ─── Freezes ─────────────────────────────────────────────────────────────────

export function CancelFreezeButton({ freezeId, approved, daysText }: { freezeId: string; approved: boolean; daysText: string }) {
  const { run, pendingKey, resultsRef } = useActionResults();
  const key = `cancel-freeze:${freezeId}`;
  return (
    <ConfirmDialog
      triggerLabel="Cancel"
      pendingLabel="Cancelling…"
      triggerSize="sm"
      title={approved ? "Cancel this freeze?" : "Withdraw this freeze request?"}
      description={
        approved
          ? `The freeze won't happen, and your end date moves back by ${daysText}.`
          : "The gym won't see this request. You can ask for other dates."
      }
      confirmLabel={approved ? "Cancel freeze" : "Withdraw request"}
      cancelLabel="Keep it"
      tone="destructive"
      action={submitTo(run, key, "Cancelling the freeze…", cancelFreezeAction)}
      pending={pendingKey === key}
      finalFocus={resultsRef}
    >
      <input type="hidden" name="freezeId" value={freezeId} />
    </ConfirmDialog>
  );
}

const FREEZE_FIELDS = ["firstDay", "lastDay"] as const;

/** `earliestStart` is a local date (YYYY-MM-DD); `earliestLabel` the same date for reading. */
export function FreezeRequestForm({
  membershipId,
  earliestStart,
  earliestLabel,
  maxDays,
}: {
  membershipId: string;
  earliestStart: string;
  earliestLabel: string;
  maxDays: number;
}) {
  const { run, pendingKey } = useActionResults();
  const formRef = useRef<HTMLFormElement>(null);
  const { errors, setClientErrors } = useFormErrors(formRef, FREEZE_FIELDS);
  const pending = pendingKey === "freeze-request";

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    const form = event.currentTarget;
    const parsed = parseForm(freezeRequestFormSchema, new FormData(form));
    if (parsed.success) {
      setClientErrors({});
      return;
    }
    event.preventDefault();
    showFieldErrors(form, parsed.fieldErrors, setClientErrors);
  }

  return (
    <form
      ref={formRef}
      noValidate
      action={submitTo(run, "freeze-request", "Requesting the freeze…", requestFreezeAction)}
      onSubmit={onSubmit}
      className="flex flex-col gap-3"
    >
      <input type="hidden" name="membershipId" value={membershipId} />
      <div className="grid gap-3 sm:grid-cols-2">
        <InputField
          id={`freeze-first-${membershipId}`}
          name="firstDay"
          type="date"
          label="First day"
          hint={`From ${earliestLabel}.`}
          error={errors.firstDay}
          min={earliestStart}
          required
        />
        <InputField
          id={`freeze-last-${membershipId}`}
          name="lastDay"
          type="date"
          label="Last day"
          hint={`Included. Whole days, up to ${maxDays}.`}
          error={errors.lastDay}
          min={earliestStart}
          required
        />
      </div>
      <p className="text-sm text-muted-foreground">The gym approves a freeze before it starts.</p>
      <SubmitButton pending={pending} variant="outline" className="self-start">
        {pending ? "Requesting…" : "Request freeze"}
      </SubmitButton>
    </form>
  );
}
