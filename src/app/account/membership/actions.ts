"use server";

import type { z } from "zod";
import { runMembershipAction, type ActionContext } from "@/lib/membership-actions";
import {
  freezeIdFormSchema,
  freezeRequestFormSchema,
  inviteFormSchema,
  inviteIdFormSchema,
  membershipIdFormSchema,
  seatIdFormSchema,
  startTrialFormSchema,
  type ActionResult,
} from "@/lib/memberships-ui/forms";
import { TRIAL_KIND_LABELS } from "@/lib/memberships-ui/labels";
import { getRequestIp } from "@/lib/request-ip";
import { cancelFreeze, requestFreeze } from "@/lib/services/memberships/freezes";
import {
  createMembershipInvite,
  leaveMembership,
  removePartner,
  resendMembershipInvite,
  revokeMembershipInvite,
  sendMembershipInvite,
  type IssuedMembershipInvite,
} from "@/lib/services/memberships/invites";
import { startTrial } from "@/lib/services/memberships/trials";
import { isoDate } from "@/lib/time";

function runMemberAction<S extends z.ZodType>(
  formData: FormData,
  schema: S,
  visibleFields: readonly string[],
  perform: (data: z.output<S>, context: ActionContext) => Promise<ActionResult>,
): Promise<ActionResult> {
  return runMembershipAction({ audience: "member", formData, schema, visibleFields, perform });
}

async function deliverInvite(invite: IssuedMembershipInvite): Promise<ActionResult> {
  return (await sendMembershipInvite(invite))
    ? { status: "success", message: "Invite sent." }
    : { status: "error", message: "The invite was created, but the email could not be sent. Use Resend to try again." };
}

export async function startTrialAction(_previous: ActionResult, formData: FormData): Promise<ActionResult> {
  return runMemberAction(formData, startTrialFormSchema, [], async ({ kind }, { user, ipHash }) => {
    await startTrial({ userId: user.id, kind, ip: await getRequestIp(), ipHash });
    return { status: "success", message: `Your ${TRIAL_KIND_LABELS[kind]} has started.` };
  });
}

export async function requestFreezeAction(_previous: ActionResult, formData: FormData): Promise<ActionResult> {
  return runMemberAction(formData, freezeRequestFormSchema, ["firstDay", "lastDay"], async (data, { user, ipHash }) => {
    await requestFreeze({
      userId: user.id,
      membershipId: data.membershipId,
      firstDay: isoDate(data.firstDay),
      lastDay: isoDate(data.lastDay),
      ipHash,
    });
    return { status: "success", message: "Freeze requested. The gym will confirm it before it starts." };
  });
}

export async function cancelFreezeAction(_previous: ActionResult, formData: FormData): Promise<ActionResult> {
  return runMemberAction(formData, freezeIdFormSchema, [], async ({ freezeId }, { user, ipHash }) => {
    const { periodShift } = await cancelFreeze({ actorId: user.id, freezeId, ipHash });
    return {
      status: "success",
      message: periodShift ? "Freeze cancelled. Your end date moved back." : "Freeze request cancelled.",
    };
  });
}

export async function createInviteAction(_previous: ActionResult, formData: FormData): Promise<ActionResult> {
  return runMemberAction(formData, inviteFormSchema, ["email"], async ({ membershipId, email }, { user, ipHash }) =>
    deliverInvite(await createMembershipInvite({ ownerId: user.id, membershipId, email, ipHash })),
  );
}

export async function resendInviteAction(_previous: ActionResult, formData: FormData): Promise<ActionResult> {
  return runMemberAction(formData, inviteIdFormSchema, [], async ({ inviteId }, { user, ipHash }) =>
    deliverInvite(await resendMembershipInvite({ actorId: user.id, inviteId, ipHash })),
  );
}

export async function revokeInviteAction(_previous: ActionResult, formData: FormData): Promise<ActionResult> {
  return runMemberAction(formData, inviteIdFormSchema, [], async ({ inviteId }, { user, ipHash }) => {
    await revokeMembershipInvite({ actorId: user.id, inviteId, ipHash });
    return { status: "success", message: "Invite withdrawn." };
  });
}

export async function removePartnerAction(_previous: ActionResult, formData: FormData): Promise<ActionResult> {
  return runMemberAction(formData, seatIdFormSchema, [], async ({ seatId }, { user, ipHash }) => {
    await removePartner({ actorId: user.id, seatId, ipHash });
    return { status: "success", message: "Partner removed." };
  });
}

export async function leaveMembershipAction(_previous: ActionResult, formData: FormData): Promise<ActionResult> {
  return runMemberAction(formData, membershipIdFormSchema, [], async ({ membershipId }, { user, ipHash }) => {
    await leaveMembership({ userId: user.id, membershipId, ipHash });
    return { status: "success", message: "You've left the membership." };
  });
}
