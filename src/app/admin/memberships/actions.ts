"use server";

import { runMembershipAction } from "@/lib/membership-actions";
import {
  extendFormSchema,
  freezeIdFormSchema,
  inviteIdFormSchema,
  refundFormSchema,
  rejectFreezeFormSchema,
  seatIdFormSchema,
  voidFormSchema,
  type ActionResult,
} from "@/lib/memberships-ui/forms";
import { formatMoney } from "@/lib/money";
import { voidPayment, refundPayment, type CorrectionEffect } from "@/lib/services/memberships/corrections";
import { MembershipError } from "@/lib/services/memberships/errors";
import { approveFreeze, cancelFreeze, rejectFreeze } from "@/lib/services/memberships/freezes";
import { removePartner, revokeMembershipInvite } from "@/lib/services/memberships/invites";
import { extendManualMembership } from "@/lib/services/memberships/manual";
import { getPaymentCurrency } from "@/lib/services/memberships/queries";

/** Row actions report at page level, so a refresh after any refusal shows what is possible now. */
const refreshAlways = () => true;

const CORRECTION_EFFECT_MESSAGES: Readonly<Record<CorrectionEffect["membership"], string>> = {
  unchanged: "The membership stays as it is.",
  rolled_back: "The membership's end moved back.",
  cancelled: "The membership is cancelled.",
};

function correctionMessage(done: string, effect: CorrectionEffect): string {
  const membership = effect.membership === "rolled_back" && effect.expired ? "The membership's end moved back, so it has ended." : CORRECTION_EFFECT_MESSAGES[effect.membership];
  return `${done} ${membership}`;
}

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

export async function voidPaymentAction(_previous: ActionResult, formData: FormData): Promise<ActionResult> {
  return runMembershipAction({
    audience: "admin",
    formData,
    schema: voidFormSchema,
    visibleFields: ["reason"],
    refreshOnError: refreshAlways,
    perform: async ({ paymentId, reason }, { user, ipHash }) => {
      const { effect } = await voidPayment({ actorId: user.id, paymentId, reason, ipHash });
      return { status: "success", message: correctionMessage("Payment voided.", effect) };
    },
  });
}

/**
 * Records a manual refund. The amount is typed in currency units and parsed with the payment's
 * currency, looked up on the server: a form field never decides it.
 */
export async function refundPaymentAction(_previous: ActionResult, formData: FormData): Promise<ActionResult> {
  let currency = "";
  return runMembershipAction({
    audience: "admin",
    formData,
    schema: async (data) => {
      const found = await getPaymentCurrency(String(data.get("paymentId") ?? ""));
      if (found === null) throw new MembershipError("PAYMENT_NOT_FOUND");
      currency = found;
      return refundFormSchema(found);
    },
    visibleFields: ["amount", "reason"],
    refreshOnError: refreshAlways,
    perform: async ({ paymentId, amountCents, reason }, { user, ipHash }) => {
      const { effect } = await refundPayment({ actorId: user.id, paymentId, amountCents, reason, ipHash });
      return { status: "success", message: correctionMessage(`Refund of ${formatMoney(amountCents, currency)} recorded.`, effect) };
    },
  });
}

export async function approveFreezeAction(_previous: ActionResult, formData: FormData): Promise<ActionResult> {
  return runMembershipAction({
    audience: "admin",
    formData,
    schema: freezeIdFormSchema,
    visibleFields: [],
    refreshOnError: refreshAlways,
    perform: async ({ freezeId }, { user, ipHash }) => {
      await approveFreeze({ actorId: user.id, freezeId, ipHash });
      return { status: "success", message: "Freeze approved. The membership's end moved later by the freeze length." };
    },
  });
}

export async function rejectFreezeAction(_previous: ActionResult, formData: FormData): Promise<ActionResult> {
  return runMembershipAction({
    audience: "admin",
    formData,
    schema: rejectFreezeFormSchema,
    visibleFields: ["reason"],
    refreshOnError: refreshAlways,
    perform: async ({ freezeId, reason }, { user, ipHash }) => {
      await rejectFreeze({ actorId: user.id, freezeId, reason, ipHash });
      return { status: "success", message: "Freeze rejected. The member sees it on their membership page." };
    },
  });
}

export async function cancelFreezeAction(_previous: ActionResult, formData: FormData): Promise<ActionResult> {
  return runMembershipAction({
    audience: "admin",
    formData,
    schema: freezeIdFormSchema,
    visibleFields: [],
    refreshOnError: refreshAlways,
    perform: async ({ freezeId }, { user, ipHash }) => {
      const { periodShift } = await cancelFreeze({ actorId: user.id, freezeId, ipHash });
      return {
        status: "success",
        message: periodShift ? "Freeze cancelled. The membership's end moved back." : "Freeze request cancelled.",
      };
    },
  });
}

export async function adminRemovePartnerAction(_previous: ActionResult, formData: FormData): Promise<ActionResult> {
  return runMembershipAction({
    audience: "admin",
    formData,
    schema: seatIdFormSchema,
    visibleFields: [],
    refreshOnError: refreshAlways,
    perform: async ({ seatId }, { user, ipHash }) => {
      await removePartner({ actorId: user.id, seatId, ipHash });
      return { status: "success", message: "Partner removed. The owner can invite someone else." };
    },
  });
}

export async function adminRevokeInviteAction(_previous: ActionResult, formData: FormData): Promise<ActionResult> {
  return runMembershipAction({
    audience: "admin",
    formData,
    schema: inviteIdFormSchema,
    visibleFields: [],
    refreshOnError: refreshAlways,
    perform: async ({ inviteId }, { user, ipHash }) => {
      await revokeMembershipInvite({ actorId: user.id, inviteId, ipHash });
      return { status: "success", message: "Invite revoked. Its link no longer works." };
    },
  });
}
