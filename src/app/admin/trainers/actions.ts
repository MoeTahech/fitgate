"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { isAuthError, requireRole } from "@/lib/auth/session";
import { getRequestIpHash } from "@/lib/request-ip";
import {
  createTrainerInvite,
  resendTrainerInvite,
  revokeTrainerInvite,
  sendTrainerInvite,
  TrainerInviteError,
  type InviteErrorCode,
} from "@/lib/services/trainer-invites";

export type InviteFormState = { status: "idle" | "success" | "error"; message?: string };

const MESSAGES: Partial<Record<InviteErrorCode, string>> = {
  ACTOR_NOT_ADMIN: "You don't have permission to manage trainer invites.",
  ALREADY_TRAINER: "This person is already a trainer or admin.",
  INVITE_NOT_FOUND: "This invite no longer exists.",
  INVITE_NOT_PENDING: "This invite is no longer pending.",
};

const NO_PERMISSION: InviteFormState = { status: "error", message: MESSAGES.ACTOR_NOT_ADMIN };

async function currentAdminId(): Promise<string | null> {
  try {
    return (await requireRole("ADMIN")).id;
  } catch (error) {
    if (isAuthError(error)) return null;
    throw error;
  }
}

function failure(error: unknown): InviteFormState {
  if (error instanceof TrainerInviteError) {
    return { status: "error", message: MESSAGES[error.code] ?? "Something went wrong. Please try again." };
  }
  throw error;
}

function sentMessage(delivered: boolean): InviteFormState {
  return delivered
    ? { status: "success", message: "Invite sent." }
    : { status: "error", message: "The invite was created, but the email could not be sent. Use Resend to try again." };
}

const emailField = z.object({ email: z.string().max(254) });
const inviteIdField = z.object({ inviteId: z.uuid() });

export async function createInviteAction(_previous: InviteFormState, formData: FormData): Promise<InviteFormState> {
  const actorId = await currentAdminId();
  if (!actorId) return NO_PERMISSION;
  const parsed = emailField.safeParse({ email: formData.get("email") });
  if (!parsed.success) return { status: "error", message: "Enter a valid email address." };

  let delivered: boolean;
  try {
    const invite = await createTrainerInvite({ actorId, email: parsed.data.email, ipHash: await getRequestIpHash() });
    delivered = await sendTrainerInvite(invite);
  } catch (error) {
    if (error instanceof z.ZodError) return { status: "error", message: "Enter a valid email address." };
    return failure(error);
  }
  refresh();
  return sentMessage(delivered);
}

export async function revokeInviteAction(_previous: InviteFormState, formData: FormData): Promise<InviteFormState> {
  const actorId = await currentAdminId();
  if (!actorId) return NO_PERMISSION;
  const parsed = inviteIdField.safeParse({ inviteId: formData.get("inviteId") });
  if (!parsed.success) return { status: "error", message: MESSAGES.INVITE_NOT_FOUND };

  try {
    await revokeTrainerInvite({ actorId, inviteId: parsed.data.inviteId, ipHash: await getRequestIpHash() });
  } catch (error) {
    return failure(error);
  }
  refresh();
  return { status: "success", message: "Invite revoked." };
}

export async function resendInviteAction(_previous: InviteFormState, formData: FormData): Promise<InviteFormState> {
  const actorId = await currentAdminId();
  if (!actorId) return NO_PERMISSION;
  const parsed = inviteIdField.safeParse({ inviteId: formData.get("inviteId") });
  if (!parsed.success) return { status: "error", message: MESSAGES.INVITE_NOT_FOUND };

  let delivered: boolean;
  try {
    const invite = await resendTrainerInvite({ actorId, inviteId: parsed.data.inviteId, ipHash: await getRequestIpHash() });
    delivered = await sendTrainerInvite(invite);
  } catch (error) {
    return failure(error);
  }
  refresh();
  return sentMessage(delivered);
}
