"use server";

import { refresh } from "next/cache";
import type { z } from "zod";
import { isAuthError, requireUser, type SessionUser } from "@/lib/auth/session";
import {
  freezeIdFormSchema,
  freezeRequestFormSchema,
  inviteFormSchema,
  inviteIdFormSchema,
  membershipIdFormSchema,
  parseForm,
  seatIdFormSchema,
  startTrialFormSchema,
  type ActionResult,
} from "@/lib/memberships-ui/forms";
import { TRIAL_KIND_LABELS } from "@/lib/memberships-ui/labels";
import { authErrorResult, membershipErrorResult } from "@/lib/memberships-ui/messages";
import { getRequestIp, getRequestIpHash } from "@/lib/request-ip";
import { MembershipError, toMembershipError } from "@/lib/services/memberships/errors";
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

type ActionContext = { user: SessionUser; ipHash: string | null };

/**
 * An invalid hidden field (an id) means the page is stale: its error becomes the message. Errors
 * on the visible fields stay field errors.
 */
function invalidForm(fieldErrors: Record<string, string>, visibleFields: readonly string[]): ActionResult {
  const hidden = Object.entries(fieldErrors).find(([field]) => !visibleFields.includes(field));
  return hidden ? { status: "error", message: hidden[1] } : { status: "error", fieldErrors };
}

/**
 * The signed-in user, the parsed form, then the service call. Membership errors become member
 * copy; once the service call succeeds, the route is refreshed.
 */
async function runMemberAction<S extends z.ZodType>(
  formData: FormData,
  schema: S,
  visibleFields: readonly string[],
  perform: (data: z.output<S>, context: ActionContext) => Promise<ActionResult>,
): Promise<ActionResult> {
  let user: SessionUser;
  try {
    user = await requireUser();
  } catch (error) {
    if (isAuthError(error)) return authErrorResult(error.code);
    throw error;
  }

  const parsed = parseForm(schema, formData);
  if (!parsed.success) return invalidForm(parsed.fieldErrors, visibleFields);

  let result: ActionResult;
  try {
    result = await perform(parsed.data, { user, ipHash: await getRequestIpHash() });
  } catch (error) {
    const mapped = toMembershipError(error);
    if (mapped instanceof MembershipError) return membershipErrorResult(mapped, "member");
    throw mapped;
  }
  refresh();
  return result;
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
