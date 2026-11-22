"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth/session";
import { getRequestIpHash } from "@/lib/request-ip";
import { acceptTrainerInvite, type AcceptResult } from "@/lib/services/trainer-invites";

export type AcceptFormState =
  | { status: "idle" }
  | { status: "accepted" }
  | { status: "error"; message: string };

const MESSAGES: Record<Extract<AcceptResult, { ok: false }>["code"], string> = {
  INVITE_NOT_FOUND: "This invite link is not valid.",
  INVITE_EXPIRED: "This invite has expired. Ask an admin to send a new one.",
  INVITE_REVOKED: "This invite was withdrawn. Ask an admin to send a new one.",
  INVITE_ALREADY_ACCEPTED: "This invite has already been used.",
  EMAIL_MISMATCH: "This invite was sent to a different email address than the one you're signed in with.",
  USER_NOT_ELIGIBLE: "Your account can't accept this invite.",
};

export async function acceptInviteAction(_previous: AcceptFormState, formData: FormData): Promise<AcceptFormState> {
  const user = await getSessionUser();
  if (!user) return { status: "error", message: "Sign in to accept this invite." };

  const token = z.string().max(128).safeParse(formData.get("token"));
  if (!token.success) return { status: "error", message: MESSAGES.INVITE_NOT_FOUND };

  const result = await acceptTrainerInvite({ userId: user.id, token: token.data, ipHash: await getRequestIpHash() });
  if (!result.ok) return { status: "error", message: MESSAGES[result.code] };

  refresh();
  return { status: "accepted" };
}
