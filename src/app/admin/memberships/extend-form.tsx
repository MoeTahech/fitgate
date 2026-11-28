"use client";

import type { FormEvent } from "react";
import { FormAlert } from "@/components/form-alert";
import { SubmitButton } from "@/components/submit-button";
import { extendFormSchema } from "@/lib/memberships-ui/forms";
import { useMembershipForm } from "@/lib/memberships-ui/use-membership-form";
import { extendMembershipAction } from "./actions";
import { PaymentFields } from "./payment-fields";

/** Records the payment that extends a running front-desk membership by one billing period. */
export function ExtendForm({ membershipId }: { membershipId: string }) {
  const { formRef, state, pending, errors, validate, submit } = useMembershipForm(extendMembershipAction, extendFormSchema);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const form = event.currentTarget;
    if (!validate(form)) return;
    submit(form, (event.nativeEvent as SubmitEvent).submitter);
  }

  return (
    <form ref={formRef} noValidate onSubmit={onSubmit} className="flex flex-col gap-4">
      <input type="hidden" name="membershipId" value={membershipId} />
      <PaymentFields idPrefix={`extend-${membershipId}`} errors={errors} />
      <FormAlert tone={state.status === "error" ? "error" : "success"}>{state.message}</FormAlert>
      <div>
        <SubmitButton pending={pending} variant="outline">
          {pending ? "Extending…" : "Record payment and extend"}
        </SubmitButton>
      </div>
    </form>
  );
}
