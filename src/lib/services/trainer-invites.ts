import "server-only";
import { z } from "zod";
import type { AppRole } from "@/lib/auth/constants";
import { emailSchema } from "@/lib/auth/schemas";
import { requireRole } from "@/lib/auth/session";
import { generateToken, sha256 } from "@/lib/crypto";
import { db } from "@/lib/db";
import { sendEmail, trainerInviteEmail } from "@/lib/email";
import { env } from "@/lib/env";
import type { InviteStatus, Prisma } from "@/generated/prisma/client";

export const TRAINER_INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_TIME_ZONE = "Asia/Beirut";

type Tx = Prisma.TransactionClient;

export type InviteErrorCode =
  | "ACTOR_NOT_ADMIN"
  | "ALREADY_TRAINER"
  | "INVITE_NOT_FOUND"
  | "INVITE_NOT_PENDING"
  | "INVITE_EXPIRED"
  | "INVITE_REVOKED"
  | "INVITE_ALREADY_ACCEPTED"
  | "EMAIL_MISMATCH"
  | "USER_NOT_ELIGIBLE";

export class TrainerInviteError extends Error {
  readonly code: InviteErrorCode;

  constructor(code: InviteErrorCode) {
    super(code);
    this.name = "TrainerInviteError";
    this.code = code;
  }
}

const idSchema = z.string().min(1).max(64);
const tokenSchema = z.string().min(20).max(128).regex(/^[A-Za-z0-9_-]+$/);
const ipHashSchema = z.string().max(128).nullish();

const createInput = z.object({ actorId: idSchema, email: emailSchema, ipHash: ipHashSchema });
const inviteActionInput = z.object({ actorId: idSchema, inviteId: z.uuid(), ipHash: ipHashSchema });
const acceptInput = z.object({ userId: idSchema, token: tokenSchema, ipHash: ipHashSchema });

export type IssuedInvite = { inviteId: string; email: string; token: string; expiresAt: Date };

type LockedInvite = {
  id: string;
  email: string;
  status: InviteStatus;
  expires_at: Date;
};

async function lockActiveAdmin(tx: Tx, actorId: string): Promise<void> {
  const [actor] = await tx.$queryRaw<{ role: AppRole; anonymized_at: Date | null }[]>`
    SELECT role::text AS role, anonymized_at FROM users WHERE id = ${actorId} FOR UPDATE
  `;
  if (!actor || actor.role !== "ADMIN" || actor.anonymized_at) throw new TrainerInviteError("ACTOR_NOT_ADMIN");
}

async function lockInviteById(tx: Tx, inviteId: string): Promise<LockedInvite | undefined> {
  const [invite] = await tx.$queryRaw<LockedInvite[]>`
    SELECT id::text AS id, email, status::text AS status, expires_at
    FROM trainer_invites WHERE id = ${inviteId}::uuid FOR UPDATE
  `;
  return invite;
}

function audit(
  tx: Tx,
  data: { actorId: string | null; action: string; targetType: string; targetId: string; details?: Prisma.InputJsonObject; ipHash?: string | null },
) {
  return tx.auditLog.create({
    data: { ...data, details: data.details ?? {}, ipHash: data.ipHash ?? null },
  });
}

async function expirePending(tx: Tx, where: { email?: string } = {}): Promise<void> {
  await tx.trainerInvite.updateMany({
    where: { status: "PENDING", expiresAt: { lte: new Date() }, ...where },
    data: { status: "EXPIRED" },
  });
}

/** Revokes pending invites for the email and issues a new one. Caller holds the admin row lock. */
async function issueInvite(tx: Tx, actorId: string, email: string, ipHash: string | null | undefined): Promise<IssuedInvite> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`trainer-invite:${email}`}, 0))`;

  const existing = await tx.user.findUnique({ where: { email }, select: { role: true, anonymizedAt: true } });
  if (existing && !existing.anonymizedAt && existing.role !== "MEMBER") throw new TrainerInviteError("ALREADY_TRAINER");

  await expirePending(tx, { email });
  const superseded = await tx.trainerInvite.findMany({ where: { email, status: "PENDING" }, select: { id: true } });
  const now = new Date();
  for (const { id } of superseded) {
    await tx.trainerInvite.update({ where: { id }, data: { status: "REVOKED", revokedAt: now, revokedById: actorId } });
    await audit(tx, {
      actorId,
      action: "trainer_invite.revoked",
      targetType: "trainer_invite",
      targetId: id,
      details: { reason: "superseded" },
      ipHash,
    });
  }

  const token = generateToken();
  const invite = await tx.trainerInvite.create({
    data: { email, tokenHash: sha256(token), invitedById: actorId, expiresAt: new Date(now.getTime() + TRAINER_INVITE_TTL_MS) },
  });
  await audit(tx, { actorId, action: "trainer_invite.created", targetType: "trainer_invite", targetId: invite.id, ipHash });

  return { inviteId: invite.id, email, token, expiresAt: invite.expiresAt };
}

export async function createTrainerInvite(input: z.input<typeof createInput>): Promise<IssuedInvite> {
  const { actorId, email, ipHash } = createInput.parse(input);
  return db.$transaction(async (tx) => {
    await lockActiveAdmin(tx, actorId);
    return issueInvite(tx, actorId, email, ipHash);
  });
}

export async function revokeTrainerInvite(input: z.input<typeof inviteActionInput>): Promise<void> {
  const { actorId, inviteId, ipHash } = inviteActionInput.parse(input);
  await db.$transaction(async (tx) => {
    await lockActiveAdmin(tx, actorId);
    const invite = await lockInviteById(tx, inviteId);
    if (!invite) throw new TrainerInviteError("INVITE_NOT_FOUND");
    if (invite.status !== "PENDING") throw new TrainerInviteError("INVITE_NOT_PENDING");

    await tx.trainerInvite.update({
      where: { id: invite.id },
      data: { status: "REVOKED", revokedAt: new Date(), revokedById: actorId },
    });
    await audit(tx, { actorId, action: "trainer_invite.revoked", targetType: "trainer_invite", targetId: invite.id, ipHash });
  });
}

/** Resend = revoke the invite (if still pending) and issue a new one for the same email. */
export async function resendTrainerInvite(input: z.input<typeof inviteActionInput>): Promise<IssuedInvite> {
  const { actorId, inviteId, ipHash } = inviteActionInput.parse(input);
  return db.$transaction(async (tx) => {
    await lockActiveAdmin(tx, actorId);
    const invite = await lockInviteById(tx, inviteId);
    if (!invite) throw new TrainerInviteError("INVITE_NOT_FOUND");
    if (invite.status !== "PENDING" && invite.status !== "EXPIRED") throw new TrainerInviteError("INVITE_NOT_PENDING");
    return issueInvite(tx, actorId, invite.email, ipHash);
  });
}

export type AcceptResult =
  | { ok: true; role: AppRole; roleChanged: boolean }
  | { ok: false; code: Extract<InviteErrorCode, "INVITE_NOT_FOUND" | "INVITE_EXPIRED" | "INVITE_REVOKED" | "INVITE_ALREADY_ACCEPTED" | "EMAIL_MISMATCH" | "USER_NOT_ELIGIBLE"> };

export async function acceptTrainerInvite(input: z.input<typeof acceptInput>): Promise<AcceptResult> {
  const parsed = acceptInput.safeParse(input);
  if (!parsed.success) return { ok: false, code: "INVITE_NOT_FOUND" };
  const { userId, token, ipHash } = parsed.data;

  return db.$transaction(async (tx): Promise<AcceptResult> => {
    const [user] = await tx.$queryRaw<
      { id: string; email: string; email_verified: boolean; role: AppRole; anonymized_at: Date | null }[]
    >`
      SELECT id, email, email_verified, role::text AS role, anonymized_at FROM users WHERE id = ${userId} FOR UPDATE
    `;
    if (!user || user.anonymized_at || !user.email_verified) return { ok: false, code: "USER_NOT_ELIGIBLE" };

    const [invite] = await tx.$queryRaw<LockedInvite[]>`
      SELECT id::text AS id, email, status::text AS status, expires_at
      FROM trainer_invites WHERE token_hash = ${sha256(token)} FOR UPDATE
    `;
    if (!invite) return { ok: false, code: "INVITE_NOT_FOUND" };
    if (invite.status === "ACCEPTED") return { ok: false, code: "INVITE_ALREADY_ACCEPTED" };
    if (invite.status === "REVOKED") return { ok: false, code: "INVITE_REVOKED" };
    if (invite.status === "EXPIRED") return { ok: false, code: "INVITE_EXPIRED" };
    if (invite.expires_at <= new Date()) {
      await tx.trainerInvite.update({ where: { id: invite.id }, data: { status: "EXPIRED" } });
      return { ok: false, code: "INVITE_EXPIRED" };
    }
    if (user.email !== invite.email) return { ok: false, code: "EMAIL_MISMATCH" };

    const from = user.role;
    const to: AppRole = from === "ADMIN" ? "ADMIN" : "TRAINER";
    const roleChanged = from !== to;

    if (roleChanged) {
      await tx.user.update({ where: { id: user.id }, data: { role: to } });
      await audit(tx, {
        actorId: user.id,
        action: "user.role_changed",
        targetType: "user",
        targetId: user.id,
        details: { from, to, via: "trainer_invite", inviteId: invite.id },
        ipHash,
      });
    }

    await tx.trainerInvite.update({
      where: { id: invite.id },
      data: { status: "ACCEPTED", acceptedAt: new Date(), acceptedById: user.id },
    });
    await audit(tx, { actorId: user.id, action: "trainer_invite.accepted", targetType: "trainer_invite", targetId: invite.id, ipHash });

    return { ok: true, role: to, roleChanged };
  });
}

export type InviteLookup =
  | { state: "valid"; email: string; expiresAt: Date }
  | { state: "expired" | "revoked" | "accepted" | "not_found" };

/** Public lookup for the accept page; marks the invite EXPIRED if its time has passed. */
export async function findInviteByToken(token: string): Promise<InviteLookup> {
  if (!tokenSchema.safeParse(token).success) return { state: "not_found" };
  const tokenHash = sha256(token);
  await db.trainerInvite.updateMany({
    where: { tokenHash, status: "PENDING", expiresAt: { lte: new Date() } },
    data: { status: "EXPIRED" },
  });
  const invite = await db.trainerInvite.findUnique({ where: { tokenHash }, select: { email: true, status: true, expiresAt: true } });
  if (!invite) return { state: "not_found" };
  if (invite.status === "PENDING") return { state: "valid", email: invite.email, expiresAt: invite.expiresAt };
  return { state: invite.status === "ACCEPTED" ? "accepted" : invite.status === "REVOKED" ? "revoked" : "expired" };
}

export type TrainerInviteListItem = {
  id: string;
  email: string;
  status: InviteStatus;
  expiresAt: Date;
  createdAt: Date;
  invitedByName: string;
};

export async function listTrainerInvites(): Promise<TrainerInviteListItem[]> {
  await requireRole("ADMIN");
  await db.$transaction((tx) => expirePending(tx));
  const invites = await db.trainerInvite.findMany({
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 100,
    select: { id: true, email: true, status: true, expiresAt: true, createdAt: true, invitedBy: { select: { name: true } } },
  });
  return invites.map(({ invitedBy, ...invite }) => ({ ...invite, invitedByName: invitedBy.name }));
}

export function trainerInviteUrl(token: string): string {
  return `${env.BETTER_AUTH_URL}/invite/trainer/${token}`;
}

/** Sends the invite email after the transaction committed. Returns false if delivery failed. */
export async function sendTrainerInvite(invite: IssuedInvite): Promise<boolean> {
  const settings = await db.gymSettings.findUnique({ where: { id: 1 }, select: { timeZone: true } });
  try {
    await sendEmail({
      to: invite.email,
      ...trainerInviteEmail({
        url: trainerInviteUrl(invite.token),
        expiresAt: invite.expiresAt,
        timeZone: settings?.timeZone ?? DEFAULT_TIME_ZONE,
      }),
    });
    return true;
  } catch {
    return false;
  }
}
