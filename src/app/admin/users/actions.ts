"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { ROLES } from "@/lib/auth/constants";
import { isAuthError, requireRole } from "@/lib/auth/session";
import { getRequestIpHash } from "@/lib/request-ip";
import { changeUserRole, RoleChangeError, type RoleChangeErrorCode } from "@/lib/services/roles";

/** `signed-out`: the admin changed their own role, which revoked their sessions. */
export type RoleFormState = { status: "idle" | "success" | "error" | "signed-out"; message?: string };

const formSchema = z.object({ userId: z.string().min(1).max(64), role: z.enum(ROLES) });

const MESSAGES: Record<RoleChangeErrorCode, string> = {
  ACTOR_NOT_ADMIN: "You no longer have permission to change roles.",
  TARGET_NOT_FOUND: "This user no longer exists.",
  TARGET_ANONYMIZED: "This account has been deleted.",
  LAST_ADMIN: "At least one admin must remain. Promote someone else first.",
  HAS_UPCOMING_CLASSES: "Reassign this person's upcoming classes and active class templates first.",
};

export async function changeRoleAction(_previous: RoleFormState, formData: FormData): Promise<RoleFormState> {
  let adminId: string;
  try {
    adminId = (await requireRole("ADMIN")).id;
  } catch (error) {
    if (isAuthError(error)) return { status: "error", message: MESSAGES.ACTOR_NOT_ADMIN };
    throw error;
  }

  const parsed = formSchema.safeParse({ userId: formData.get("userId"), role: formData.get("role") });
  if (!parsed.success) return { status: "error", message: "Choose a valid role." };

  let changedOwnRole = false;
  try {
    const result = await changeUserRole({
      actorId: adminId,
      targetUserId: parsed.data.userId,
      newRole: parsed.data.role,
      ipHash: await getRequestIpHash(),
    });
    if (!result.changed) return { status: "success", message: "No change." };
    changedOwnRole = parsed.data.userId === adminId;
  } catch (error) {
    if (error instanceof RoleChangeError) return { status: "error", message: MESSAGES[error.code] };
    throw error;
  }

  if (changedOwnRole) return { status: "signed-out" };
  refresh();
  return { status: "success", message: "Role updated." };
}
