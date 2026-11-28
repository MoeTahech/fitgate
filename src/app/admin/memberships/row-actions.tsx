"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useActionResults, type RowAction } from "@/components/action-results";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { InputField, TextareaField } from "@/components/form-field";
import { SubmitButton } from "@/components/submit-button";
import type { MembershipStatus } from "@/generated/prisma/enums";
import { showFieldErrors } from "@/lib/forms/field-errors";
import { refundEffectText } from "@/lib/memberships-ui/display";
import { parseForm, refundFormSchema, rejectFreezeFormSchema, voidFormSchema } from "@/lib/memberships-ui/forms";
import { centsToAmountInput, formatMoney, parseAmountToCents } from "@/lib/money";
import { FREE_TEXT_MAX_LENGTH } from "@/lib/services/memberships/schemas";
import {
  adminRemovePartnerAction,
  adminRevokeInviteAction,
  approveFreezeAction,
  cancelFreezeAction,
  refundPaymentAction,
  rejectFreezeAction,
  voidPaymentAction,
} from "./actions";

type Run = ReturnType<typeof useActionResults>["run"];

function submitTo(run: Run, key: string, pendingMessage: string, action: RowAction) {
  return (formData: FormData) => run({ key, pendingMessage, action, formData });
}

// ─── Dialog fields ───────────────────────────────────────────────────────────

type Validator = (form: HTMLFormElement) => boolean;
type FieldCheck = (form: HTMLFormElement) => Record<string, string> | null;

/**
 * Connects a `ConfirmDialog`'s `validate` to its fields component, which owns the field errors:
 * the fields unmount when the dialog closes, so their errors are gone when it reopens.
 */
function useDialogValidation() {
  const validator = useRef<Validator | null>(null);
  const register = useCallback((next: Validator | null) => {
    validator.current = next;
  }, []);
  const validate = useCallback((form: HTMLFormElement) => validator.current?.(form) ?? false, []);
  return { register, validate };
}

/** Inside the fields component: registers the check while mounted and keeps its errors. */
function useFieldErrors(register: (validator: Validator | null) => void, check: FieldCheck) {
  const [errors, setErrors] = useState<Record<string, string>>({});
  useEffect(() => {
    register((form) => {
      const found = check(form);
      if (!found) {
        setErrors({});
        return true;
      }
      showFieldErrors(form, found, setErrors);
      return false;
    });
    return () => register(null);
  }, [register, check]);
  return errors;
}

function schemaCheck(schema: Parameters<typeof parseForm>[0]): FieldCheck {
  return (form) => {
    const parsed = parseForm(schema, new FormData(form));
    return parsed.success ? null : parsed.fieldErrors;
  };
}

const checkVoid = schemaCheck(voidFormSchema);
const checkReject = schemaCheck(rejectFreezeFormSchema);

function ReasonField({ formId, error, label, hint }: { formId: string; error?: string; label: string; hint: string }) {
  const id = useId();
  return (
    <TextareaField
      id={id}
      form={formId}
      name="reason"
      label={label}
      hint={hint}
      error={error}
      maxLength={FREE_TEXT_MAX_LENGTH}
      rows={2}
    />
  );
}

// ─── Payments ────────────────────────────────────────────────────────────────

function VoidFields({ formId, register }: { formId: string; register: (validator: Validator | null) => void }) {
  const errors = useFieldErrors(register, checkVoid);
  return <ReasonField formId={formId} error={errors.reason} label="Reason" hint="Required, for staff. No personal data: no email addresses or links." />;
}

export function VoidPaymentButton({ paymentId, description }: { paymentId: string; description: string }) {
  const { run, pendingKey, resultsRef } = useActionResults();
  const { register, validate } = useDialogValidation();
  const key = `void:${paymentId}`;
  return (
    <ConfirmDialog
      triggerLabel="Void"
      pendingLabel="Voiding…"
      triggerSize="sm"
      title="Void this payment?"
      description={`Use this for a payment recorded by mistake. ${description}`}
      confirmLabel="Void payment"
      tone="destructive"
      action={submitTo(run, key, "Voiding the payment…", voidPaymentAction)}
      pending={pendingKey === key}
      finalFocus={resultsRef}
      fields={(formId) => <VoidFields formId={formId} register={register} />}
      validate={validate}
    >
      <input type="hidden" name="paymentId" value={paymentId} />
    </ConfirmDialog>
  );
}

type RefundTarget = {
  paymentId: string;
  amountCents: number;
  currency: string;
  /** Only the membership's latest payment can be refunded in full. */
  canRefundFull: boolean;
  periodStart: Date | null;
  membership: { status: MembershipStatus; currentPeriodStart: Date };
  timeZone: string;
  now: Date;
};

function RefundFields({
  formId,
  register,
  target,
  amount,
  onAmountChange,
}: {
  formId: string;
  register: (validator: Validator | null) => void;
  target: RefundTarget;
  amount: string;
  onAmountChange: (amount: string) => void;
}) {
  const amountId = useId();
  const { amountCents, currency, canRefundFull } = target;
  const check = useCallback<FieldCheck>(
    (form) => {
      const parsed = parseForm(refundFormSchema(currency, { amountCents, fullAllowed: canRefundFull }), new FormData(form));
      return parsed.success ? null : parsed.fieldErrors;
    },
    [amountCents, currency, canRefundFull],
  );
  const errors = useFieldErrors(register, check);
  const full = formatMoney(amountCents, currency);
  return (
    <>
      <InputField
        id={amountId}
        form={formId}
        name="amount"
        label="Amount"
        hint={canRefundFull ? `Up to ${full}.` : `Less than ${full}: only the membership's latest payment can be refunded in full.`}
        error={errors.amount}
        value={amount}
        onChange={(event) => onAmountChange(event.target.value)}
        inputMode="decimal"
        autoComplete="off"
      />
      <ReasonField formId={formId} error={errors.reason} label="Reason" hint="Required, for staff. No personal data: no email addresses or links." />
    </>
  );
}

/**
 * Records a manual refund. The amount starts at the full amount when a full refund is allowed, and
 * the description follows it: a full refund withdraws the paid period like a void.
 */
export function RefundPaymentButton({ target }: { target: RefundTarget }) {
  const { run, pendingKey, resultsRef } = useActionResults();
  const { register, validate } = useDialogValidation();
  const defaultAmount = target.canRefundFull ? centsToAmountInput(target.amountCents, target.currency) : "";
  const [amount, setAmount] = useState(defaultAmount);
  const key = `refund:${target.paymentId}`;

  const typedCents = parseAmountToCents(amount, target.currency);
  const effect = refundEffectText(
    typedCents,
    { periodStart: target.periodStart, amountCents: target.amountCents, canRefundFull: target.canRefundFull },
    target.membership,
    target.timeZone,
    target.now,
  );

  return (
    <ConfirmDialog
      triggerLabel="Refund"
      pendingLabel="Refunding…"
      triggerSize="sm"
      title="Record a refund?"
      description={`Record money paid back for this ${formatMoney(target.amountCents, target.currency)} payment. ${effect}`}
      confirmLabel="Record refund"
      tone="destructive"
      action={submitTo(run, key, "Recording the refund…", refundPaymentAction)}
      pending={pendingKey === key}
      finalFocus={resultsRef}
      onOpenChange={(open) => {
        if (open) setAmount(defaultAmount);
      }}
      fields={(formId) => (
        <RefundFields formId={formId} register={register} target={target} amount={amount} onAmountChange={setAmount} />
      )}
      validate={validate}
    >
      <input type="hidden" name="paymentId" value={target.paymentId} />
    </ConfirmDialog>
  );
}

// ─── Freezes ─────────────────────────────────────────────────────────────────

/** Approving removes the request from the list, so focus moves to the results region first. */
export function ApproveFreezeButton({ freezeId }: { freezeId: string }) {
  const { run, pendingKey, resultsRef } = useActionResults();
  const key = `approve:${freezeId}`;
  const pending = pendingKey === key;
  const approve = submitTo(run, key, "Approving the freeze…", approveFreezeAction);
  return (
    <form
      action={(formData) => {
        resultsRef.current?.focus();
        approve(formData);
      }}
    >
      <input type="hidden" name="freezeId" value={freezeId} />
      <SubmitButton pending={pending} size="sm">
        {pending ? "Approving…" : "Approve"}
      </SubmitButton>
    </form>
  );
}

function RejectFields({ formId, register }: { formId: string; register: (validator: Validator | null) => void }) {
  const errors = useFieldErrors(register, checkReject);
  return (
    <ReasonField
      formId={formId}
      error={errors.reason}
      label="Reason (optional)"
      hint="The member sees it on their membership page. No personal data: no email addresses or links."
    />
  );
}

export function RejectFreezeButton({ freezeId, description }: { freezeId: string; description: string }) {
  const { run, pendingKey, resultsRef } = useActionResults();
  const { register, validate } = useDialogValidation();
  const key = `reject:${freezeId}`;
  return (
    <ConfirmDialog
      triggerLabel="Reject"
      pendingLabel="Rejecting…"
      triggerSize="sm"
      title="Reject this freeze request?"
      description={description}
      confirmLabel="Reject request"
      tone="destructive"
      action={submitTo(run, key, "Rejecting the freeze…", rejectFreezeAction)}
      pending={pendingKey === key}
      finalFocus={resultsRef}
      fields={(formId) => <RejectFields formId={formId} register={register} />}
      validate={validate}
    >
      <input type="hidden" name="freezeId" value={freezeId} />
    </ConfirmDialog>
  );
}

export function CancelFreezeButton({ freezeId, daysText }: { freezeId: string; daysText: string }) {
  const { run, pendingKey, resultsRef } = useActionResults();
  const key = `cancel-freeze:${freezeId}`;
  return (
    <ConfirmDialog
      triggerLabel="Cancel freeze"
      pendingLabel="Cancelling…"
      triggerSize="sm"
      title="Cancel this approved freeze?"
      description={`The freeze won't happen, and the membership's end moves back by ${daysText}.`}
      confirmLabel="Cancel freeze"
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

// ─── Seats and invites ───────────────────────────────────────────────────────

export function RemovePartnerButton({ seatId, name }: { seatId: string; name: string }) {
  const { run, pendingKey, resultsRef } = useActionResults();
  const key = `remove:${seatId}`;
  return (
    <ConfirmDialog
      triggerLabel="Remove"
      pendingLabel="Removing…"
      triggerSize="sm"
      title={`Remove ${name}?`}
      description={`${name} loses access right away. The owner can invite someone else.`}
      confirmLabel="Remove partner"
      tone="destructive"
      action={submitTo(run, key, "Removing the partner…", adminRemovePartnerAction)}
      pending={pendingKey === key}
      finalFocus={resultsRef}
    >
      <input type="hidden" name="seatId" value={seatId} />
    </ConfirmDialog>
  );
}

export function RevokeInviteButton({ inviteId, email }: { inviteId: string; email: string }) {
  const { run, pendingKey, resultsRef } = useActionResults();
  const key = `revoke:${inviteId}`;
  return (
    <ConfirmDialog
      triggerLabel="Revoke"
      pendingLabel="Revoking…"
      triggerSize="sm"
      title="Revoke this invite?"
      description={`The link sent to ${email} will stop working. The owner can send a new invite.`}
      confirmLabel="Revoke invite"
      tone="destructive"
      action={submitTo(run, key, "Revoking the invite…", adminRevokeInviteAction)}
      pending={pendingKey === key}
      finalFocus={resultsRef}
    >
      <input type="hidden" name="inviteId" value={inviteId} />
    </ConfirmDialog>
  );
}
