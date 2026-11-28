"use client";

import { useId, useRef, useState, type FormEvent } from "react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { FormAlert } from "@/components/form-alert";
import { SelectField } from "@/components/form-field";
import { SubmitButton } from "@/components/submit-button";
import { NativeSelectOption } from "@/components/ui/native-select";
import type { RecordPaymentNotice } from "@/lib/memberships-ui/display";
import { recordPaymentFormSchema } from "@/lib/memberships-ui/forms";
import { useMembershipForm } from "@/lib/memberships-ui/use-membership-form";
import { PaymentFields } from "../../memberships/payment-fields";
import { recordPaymentAction } from "./actions";
import { CONFIRM_SWITCH, isSwitchConfirmation, recordPaymentStep } from "./record-payment-submit";

export type RecordPaymentPlanOption = {
  id: string;
  /** "Basic · US$30.00" */
  label: string;
  notice: RecordPaymentNotice | null;
};

/**
 * Records a front-desk payment for a plan. The selected plan's notice says what recording it does
 * to the member's open base; a switch submits only through its confirm dialog, whose confirm button
 * adds `confirmSwitch` (the form never holds it), and a blocked plan can't be submitted.
 */
export function RecordPaymentForm({ userId, plans }: { userId: string; plans: readonly RecordPaymentPlanOption[] }) {
  const formId = useId();
  const resultRef = useRef<HTMLDivElement>(null);
  const [planId, setPlanId] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const { formRef, state, pending, errors, validate, submit } = useMembershipForm(recordPaymentAction, recordPaymentFormSchema);

  const notice = plans.find((plan) => plan.id === planId)?.notice ?? null;

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const form = event.currentTarget;
    const { submitter } = event.nativeEvent as SubmitEvent;
    const confirmed = isSwitchConfirmation(submitter instanceof HTMLButtonElement ? submitter : null);

    const step = recordPaymentStep({ notice, confirmed });
    if (step === "blocked" || !validate(form)) return;
    if (step === "confirm") {
      setConfirmOpen(true);
      return;
    }
    submit(form, submitter);
  }

  return (
    <form
      id={formId}
      ref={formRef}
      noValidate
      onSubmit={onSubmit}
      onReset={() => setPlanId("")}
      className="flex flex-col gap-4"
    >
      <input type="hidden" name="userId" value={userId} />
      <SelectField
        id={`${formId}-plan`}
        name="planId"
        label="Plan"
        defaultValue=""
        onChange={(event) => setPlanId(event.target.value)}
        error={errors.planId}
        required
        className="w-full"
      >
        <NativeSelectOption value="" disabled>
          Choose a plan
        </NativeSelectOption>
        {plans.map((plan) => (
          <NativeSelectOption key={plan.id} value={plan.id}>
            {plan.label}
          </NativeSelectOption>
        ))}
      </SelectField>
      <FormAlert tone={notice?.tone ?? "info"}>{notice?.text}</FormAlert>
      <PaymentFields idPrefix={formId} errors={errors} />
      <div ref={resultRef} tabIndex={-1} className="outline-none">
        <FormAlert tone={state.status === "error" ? "error" : "success"}>{state.message}</FormAlert>
      </div>
      <div>
        {notice?.needsConfirm ? (
          <ConfirmDialog
            triggerLabel="Record payment"
            pendingLabel="Recording…"
            triggerVariant="default"
            title={notice.confirmTitle ?? "Switch membership?"}
            description={notice.confirmText}
            confirmLabel="Switch and record"
            tone="destructive"
            form={formId}
            validate={validate}
            submitValue={CONFIRM_SWITCH}
            open={confirmOpen}
            onOpenChange={setConfirmOpen}
            pending={pending}
            finalFocus={resultRef}
          />
        ) : (
          <SubmitButton pending={pending} disabled={notice?.blocked}>
            {pending ? "Recording…" : "Record payment"}
          </SubmitButton>
        )}
      </div>
    </form>
  );
}
