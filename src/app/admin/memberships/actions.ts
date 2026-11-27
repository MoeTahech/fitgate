"use server";

import { runMembershipAction } from "@/lib/membership-actions";
import { extendFormSchema, type ActionResult } from "@/lib/memberships-ui/forms";
import { extendManualMembership } from "@/lib/services/memberships/manual";

/** Records a front-desk payment that extends a running membership by one billing period. */
export async function extendMembershipAction(_previous: ActionResult, formData: FormData): Promise<ActionResult> {
  return runMembershipAction({
    audience: "admin",
    formData,
    schema: extendFormSchema,
    visibleFields: ["method", "reference", "note"],
    perform: async (data, { user, ipHash }) => {
      await extendManualMembership({
        actorId: user.id,
        membershipId: data.membershipId,
        method: data.method,
        reference: data.reference,
        note: data.note,
        ipHash,
      });
      return { status: "success", message: "Payment recorded. The membership is extended by one billing period." };
    },
  });
}
