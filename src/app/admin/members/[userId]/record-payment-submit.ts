import type { RecordPaymentNotice } from "@/lib/memberships-ui/display";

/** The switch dialog's confirm button submits with this; the form itself never holds it. */
export const CONFIRM_SWITCH = { name: "confirmSwitch", value: "true" } as const;

export type RecordPaymentStep = "blocked" | "confirm" | "submit";

/** Whether the submit came from the switch dialog's confirm button. */
export function isSwitchConfirmation(submitter: { name?: string; value?: string } | null | undefined): boolean {
  return submitter?.name === CONFIRM_SWITCH.name && submitter.value === CONFIRM_SWITCH.value;
}

/**
 * What a submit of the record-payment form does for the selected plan: nothing when recording it
 * can't succeed, open the switch dialog when a switch isn't confirmed yet (Enter in a field, or a
 * stale button), otherwise send it.
 */
export function recordPaymentStep({
  notice,
  confirmed,
}: {
  notice: Pick<RecordPaymentNotice, "blocked" | "needsConfirm"> | null;
  confirmed: boolean;
}): RecordPaymentStep {
  if (notice?.blocked) return "blocked";
  if (notice?.needsConfirm && !confirmed) return "confirm";
  return "submit";
}
