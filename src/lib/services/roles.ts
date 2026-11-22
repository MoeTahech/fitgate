import "server-only";
import { z } from "zod";
import { ROLES, type AppRole } from "@/lib/auth/constants";
import { db } from "@/lib/db";

export const changeUserRoleInput = z.object({
  actorId: z.string().min(1).max(64),
  targetUserId: z.string().min(1).max(64),
  newRole: z.enum(ROLES),
  ipHash: z.string().max(128).nullish(),
});

export type ChangeUserRoleInput = z.input<typeof changeUserRoleInput>;

export type RoleChangeErrorCode =
  | "ACTOR_NOT_ADMIN"
  | "TARGET_NOT_FOUND"
  | "TARGET_ANONYMIZED"
  | "LAST_ADMIN"
  | "HAS_UPCOMING_CLASSES";

export class RoleChangeError extends Error {
  readonly code: RoleChangeErrorCode;

  constructor(code: RoleChangeErrorCode) {
    super(code);
    this.name = "RoleChangeError";
    this.code = code;
  }
}

export type RoleChangeResult = { changed: boolean; from: AppRole; to: AppRole };

const RANK: Record<AppRole, number> = { MEMBER: 0, TRAINER: 1, ADMIN: 2 };

type LockedUser = { id: string; role: AppRole; anonymized_at: Date | null };

export async function changeUserRole(input: ChangeUserRoleInput): Promise<RoleChangeResult> {
  const { actorId, targetUserId, newRole, ipHash } = changeUserRoleInput.parse(input);

  try {
    return await db.$transaction(async (tx) => {
      // Lock the actor, the target, and every admin in id order so concurrent role changes serialize.
      const rows = await tx.$queryRaw<LockedUser[]>`
        SELECT id, role::text AS role, anonymized_at
        FROM users
        WHERE role = 'ADMIN' OR id IN (${actorId}, ${targetUserId})
        ORDER BY id
        FOR UPDATE
      `;

      const actor = rows.find((row) => row.id === actorId);
      if (!actor || actor.role !== "ADMIN" || actor.anonymized_at) throw new RoleChangeError("ACTOR_NOT_ADMIN");

      const target = rows.find((row) => row.id === targetUserId);
      if (!target) throw new RoleChangeError("TARGET_NOT_FOUND");
      if (target.anonymized_at) throw new RoleChangeError("TARGET_ANONYMIZED");

      const from = target.role;
      if (from === newRole) return { changed: false, from, to: newRole };

      if (from === "ADMIN") {
        const activeAdmins = rows.filter((row) => row.role === "ADMIN" && !row.anonymized_at).length;
        if (activeAdmins <= 1) throw new RoleChangeError("LAST_ADMIN");
      }

      if (newRole === "MEMBER") {
        const now = new Date();
        const upcomingSessions = await tx.classSession.count({
          where: { trainerId: target.id, status: "SCHEDULED", startsAt: { gt: now } },
        });
        const activeTemplates = await tx.classTemplate.count({ where: { trainerId: target.id, active: true } });
        if (upcomingSessions > 0 || activeTemplates > 0) throw new RoleChangeError("HAS_UPCOMING_CLASSES");
      }

      await tx.user.update({ where: { id: target.id }, data: { role: newRole } });

      if (RANK[newRole] < RANK[from]) {
        await tx.session.deleteMany({ where: { userId: target.id } });
      }

      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          action: "user.role_changed",
          targetType: "user",
          targetId: target.id,
          details: { from, to: newRole },
          ipHash: ipHash ?? null,
        },
      });

      return { changed: true, from, to: newRole };
    });
  } catch (error) {
    if (error instanceof Error && error.message.includes("users_last_admin_guard")) {
      throw new RoleChangeError("LAST_ADMIN");
    }
    throw error;
  }
}
