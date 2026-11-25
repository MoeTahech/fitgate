"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth/session";
import { getRequestIpHash } from "@/lib/request-ip";
import { MembershipError, type MembershipErrorCode } from "@/lib/services/memberships/errors";
import { acceptMembershipInvite } from "@/lib/services/memberships/invites";

export type AcceptFormState =
  | { status: "idle" }
  | { status: "accepted" }
  | { status: "error"; message: string };

const NOT_FOUND = "This invite link is not valid.";

const MESSAGES: Partial<Record<MembershipErrorCode, string>> = {
  INVITE_NOT_FOUND: NOT_FOUND,
  INVITE_EXPIRED: "This invite has expired. Ask the person who invited you to send a new one.",
  INVITE_REVOKED: "This invite was withdrawn. Ask the person who invited you if you think this is a mistake.",
  INVITE_ALREADY_ACCEPTED: "This invite has already been used.",
  EMAIL_MISMATCH: "This invite was sent to a different email address than the one you're signed in with.",
  EMAIL_NOT_VERIFIED: "Verify your email address before accepting this invite.",
  OWN_MEMBERSHIP: "This invite is for your own membership.",
  MEMBERSHIP_ENDED: "This membership has ended, so the invite can no longer be used.",
  NO_FREE_SEAT: "This membership has no free place left.",
  HAS_ACTIVE_BASE:
    "You already have an active gym membership, so you can't join this one. Once yours has ended, ask for a new invite.",
  USER_NOT_FOUND: "Your account can't accept this invite.",
  USER_ANONYMIZED: "Your account can't accept this invite.",
};

export async function acceptInviteAction(_previous: AcceptFormState, formData: FormData): Promise<AcceptFormState> {
  const user = await getSessionUser();
  if (!user) return { status: "error", message: "Sign in to accept this invite." };

  const token = z.string().max(128).safeParse(formData.get("token"));
  if (!token.success) return { status: "error", message: NOT_FOUND };

  try {
    await acceptMembershipInvite({ userId: user.id, token: token.data, ipHash: await getRequestIpHash() });
  } catch (error) {
    if (error instanceof MembershipError) {
      return { status: "error", message: MESSAGES[error.code] ?? "Something went wrong. Please try again." };
    }
    throw error;
  }

  refresh();
  return { status: "accepted" };
}
