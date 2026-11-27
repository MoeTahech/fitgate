"use server";

import { runMembershipAction } from "@/lib/membership-actions";
import { recordPaymentFormSchema, type ActionResult } from "@/lib/memberships-ui/forms";
import type { MembershipErrorCode } from "@/lib/services/memberships/errors";
import { createManualMembership } from "@/lib/services/memberships/manual";

const RECORDED_MESSAGES = {
  none: "Payment recorded. The membership has started.",
  superseded: "Payment recorded. The membership has started, and their Day Pass or trial has ended.",
  switched: "Payment recorded. The membership has started, and their previous membership has ended.",
} as const;

/** The options the form shows came from a stale page; a refresh shows what recording each plan does now. */
const STALE_OPTION_CODES: readonly MembershipErrorCode[] = ["HAS_ACTIVE_BASE", "SAME_PLAN", "PLAN_UNAVAILABLE", "CLOSED_FOR_TODAY"];

/**
 * Records a front-desk payment for a plan, which starts a membership. `confirmSwitch` comes only
 * from the switch dialog's confirm; without it a switch is refused with the days it would lose.
 */
export async function recordPaymentAction(_previous: ActionResult, formData: FormData): Promise<ActionResult> {
  return runMembershipAction({
    audience: "admin",
    formData,
    schema: recordPaymentFormSchema,
    visibleFields: ["planId", "method", "reference", "note"],
    refreshOnError: (error) => STALE_OPTION_CODES.includes(error.code),
    perform: async (data, { user, ipHash }) => {
      const { replaced } = await createManualMembership({
        actorId: user.id,
        userId: data.userId,
        planId: data.planId,
        method: data.method,
        reference: data.reference,
        note: data.note,
        confirmSwitch: data.confirmSwitch,
        ipHash,
      });
      return { status: "success", message: RECORDED_MESSAGES[replaced.action] };
    },
  });
}
