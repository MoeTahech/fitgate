import { beforeEach, describe, expect, it } from "vitest";
import { sha256 } from "@/lib/crypto";
import { db } from "@/lib/db";
import { resetDatabase } from "../../../tests/support/database";
import { createUser } from "../../../tests/support/factories";
import {
  acceptTrainerInvite,
  createTrainerInvite,
  findInviteByToken,
  resendTrainerInvite,
  revokeTrainerInvite,
  TRAINER_INVITE_TTL_MS,
  TrainerInviteError,
  type InviteErrorCode,
} from "./trainer-invites";

beforeEach(async () => {
  await resetDatabase();
});

async function expectInviteError(promise: Promise<unknown>, code: InviteErrorCode) {
  const error = await promise.then(
    () => null,
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(TrainerInviteError);
  expect((error as TrainerInviteError).code).toBe(code);
}

async function setup(email = "coach@example.test") {
  const admin = await createUser({ role: "ADMIN" });
  const invite = await createTrainerInvite({ actorId: admin.id, email, ipHash: "ip" });
  return { admin, invite };
}

describe("createTrainerInvite", () => {
  it("stores only the token hash, expires in 7 days, and audits without the email", async () => {
    const before = Date.now();
    const { admin, invite } = await setup("Coach@Example.test");

    expect(invite.email).toBe("coach@example.test");
    expect(invite.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const row = await db.trainerInvite.findUniqueOrThrow({ where: { id: invite.inviteId } });
    expect(row.tokenHash).toBe(sha256(invite.token));
    expect(row.tokenHash).not.toContain(invite.token);
    expect(row.status).toBe("PENDING");
    expect(row.expiresAt.getTime() - before).toBeGreaterThanOrEqual(TRAINER_INVITE_TTL_MS - 1000);
    expect(row.expiresAt.getTime() - before).toBeLessThanOrEqual(TRAINER_INVITE_TTL_MS + 5000);

    const audit = await db.auditLog.findFirstOrThrow({ where: { action: "trainer_invite.created" } });
    expect(audit).toMatchObject({ actorId: admin.id, targetType: "trainer_invite", targetId: invite.inviteId, ipHash: "ip" });
    expect(JSON.stringify(audit.details)).not.toContain("coach");
  });

  it("rejects emails that already belong to a trainer or admin", async () => {
    const admin = await createUser({ role: "ADMIN" });
    const trainer = await createUser({ role: "TRAINER" });
    await expectInviteError(createTrainerInvite({ actorId: admin.id, email: trainer.email }), "ALREADY_TRAINER");
    await expectInviteError(createTrainerInvite({ actorId: admin.id, email: admin.email }), "ALREADY_TRAINER");
    const member = await createUser();
    await expect(createTrainerInvite({ actorId: admin.id, email: member.email })).resolves.toBeDefined();
  });

  it("rejects non-admin actors", async () => {
    const trainer = await createUser({ role: "TRAINER" });
    await expectInviteError(createTrainerInvite({ actorId: trainer.id, email: "x@example.test" }), "ACTOR_NOT_ADMIN");
    expect(await db.trainerInvite.count()).toBe(0);
  });

  it("revokes the previous pending invite for the same email", async () => {
    const { admin, invite: first } = await setup();
    const second = await createTrainerInvite({ actorId: admin.id, email: first.email });

    const rows = await db.trainerInvite.findMany({ orderBy: { createdAt: "asc" } });
    expect(rows.map((r) => r.status)).toEqual(["REVOKED", "PENDING"]);
    expect(rows[0]).toMatchObject({ id: first.inviteId, revokedById: admin.id });
    expect(rows[1].id).toBe(second.inviteId);
    expect(await db.auditLog.count({ where: { action: "trainer_invite.revoked", targetId: first.inviteId } })).toBe(1);
  });

  it("keeps one pending invite per email under concurrent creation", async () => {
    const admin = await createUser({ role: "ADMIN" });
    const otherAdmin = await createUser({ role: "ADMIN" });
    await Promise.all([
      createTrainerInvite({ actorId: admin.id, email: "coach@example.test" }),
      createTrainerInvite({ actorId: otherAdmin.id, email: "coach@example.test" }),
    ]);
    expect(await db.trainerInvite.count({ where: { status: "PENDING" } })).toBe(1);
    expect(await db.trainerInvite.count({ where: { status: "REVOKED" } })).toBe(1);
  });
});

describe("acceptTrainerInvite", () => {
  it("makes the invited member a trainer and audits the change", async () => {
    const { invite } = await setup();
    const member = await createUser({ email: invite.email });

    expect(await acceptTrainerInvite({ userId: member.id, token: invite.token, ipHash: "ip" })).toEqual({
      ok: true,
      role: "TRAINER",
      roleChanged: true,
    });

    expect((await db.user.findUniqueOrThrow({ where: { id: member.id } })).role).toBe("TRAINER");
    expect(await db.trainerInvite.findUniqueOrThrow({ where: { id: invite.inviteId } })).toMatchObject({
      status: "ACCEPTED",
      acceptedById: member.id,
    });
    const roleAudit = await db.auditLog.findFirstOrThrow({ where: { action: "user.role_changed" } });
    expect(roleAudit).toMatchObject({ actorId: member.id, targetId: member.id });
    expect(roleAudit.details).toEqual({ from: "MEMBER", to: "TRAINER", via: "trainer_invite", inviteId: invite.inviteId });
    expect(await db.auditLog.count({ where: { action: "trainer_invite.accepted", targetId: invite.inviteId } })).toBe(1);
  });

  it("keeps an admin an admin", async () => {
    const { admin, invite } = await setup();
    await db.trainerInvite.update({ where: { id: invite.inviteId }, data: { email: admin.email } });
    expect(await acceptTrainerInvite({ userId: admin.id, token: invite.token })).toEqual({
      ok: true,
      role: "ADMIN",
      roleChanged: false,
    });
    expect(await db.auditLog.count({ where: { action: "user.role_changed" } })).toBe(0);
  });

  it("rejects and marks an expired invite", async () => {
    const { invite } = await setup();
    const member = await createUser({ email: invite.email });
    await db.$executeRaw`UPDATE trainer_invites SET created_at = now() - interval '8 days', expires_at = now() - interval '1 day' WHERE id = ${invite.inviteId}::uuid`;

    expect(await acceptTrainerInvite({ userId: member.id, token: invite.token })).toEqual({ ok: false, code: "INVITE_EXPIRED" });
    expect((await db.trainerInvite.findUniqueOrThrow({ where: { id: invite.inviteId } })).status).toBe("EXPIRED");
    expect((await db.user.findUniqueOrThrow({ where: { id: member.id } })).role).toBe("MEMBER");
  });

  it("rejects revoked and already accepted invites", async () => {
    const { admin, invite } = await setup();
    const member = await createUser({ email: invite.email });
    await revokeTrainerInvite({ actorId: admin.id, inviteId: invite.inviteId });
    expect(await acceptTrainerInvite({ userId: member.id, token: invite.token })).toEqual({ ok: false, code: "INVITE_REVOKED" });

    const fresh = await createTrainerInvite({ actorId: admin.id, email: invite.email });
    expect((await acceptTrainerInvite({ userId: member.id, token: fresh.token })).ok).toBe(true);
    expect(await acceptTrainerInvite({ userId: member.id, token: fresh.token })).toEqual({
      ok: false,
      code: "INVITE_ALREADY_ACCEPTED",
    });
  });

  it("rejects a signed-in user with a different or unverified email", async () => {
    const { invite } = await setup();
    const other = await createUser({ email: "someone-else@example.test" });
    expect(await acceptTrainerInvite({ userId: other.id, token: invite.token })).toEqual({ ok: false, code: "EMAIL_MISMATCH" });

    const unverified = await createUser({ email: "unverified@example.test", emailVerified: false });
    await db.trainerInvite.update({ where: { id: invite.inviteId }, data: { email: unverified.email } });
    expect(await acceptTrainerInvite({ userId: unverified.id, token: invite.token })).toEqual({
      ok: false,
      code: "USER_NOT_ELIGIBLE",
    });
    expect((await db.trainerInvite.findUniqueOrThrow({ where: { id: invite.inviteId } })).status).toBe("PENDING");
  });

  it("rejects unknown and malformed tokens", async () => {
    const member = await createUser();
    expect(await acceptTrainerInvite({ userId: member.id, token: "A".repeat(43) })).toEqual({ ok: false, code: "INVITE_NOT_FOUND" });
    expect(await acceptTrainerInvite({ userId: member.id, token: "not a token" })).toEqual({ ok: false, code: "INVITE_NOT_FOUND" });
  });

  it("succeeds only once under concurrent acceptance", async () => {
    const { invite } = await setup();
    const member = await createUser({ email: invite.email });
    const results = await Promise.all([
      acceptTrainerInvite({ userId: member.id, token: invite.token }),
      acceptTrainerInvite({ userId: member.id, token: invite.token }),
      acceptTrainerInvite({ userId: member.id, token: invite.token }),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok).every((r) => !r.ok && r.code === "INVITE_ALREADY_ACCEPTED")).toBe(true);
    expect(await db.auditLog.count({ where: { action: "trainer_invite.accepted" } })).toBe(1);
    expect(await db.auditLog.count({ where: { action: "user.role_changed" } })).toBe(1);
  });
});

describe("revoke and resend", () => {
  it("revokes a pending invite with an audit row", async () => {
    const { admin, invite } = await setup();
    await revokeTrainerInvite({ actorId: admin.id, inviteId: invite.inviteId, ipHash: "ip" });
    expect(await db.trainerInvite.findUniqueOrThrow({ where: { id: invite.inviteId } })).toMatchObject({
      status: "REVOKED",
      revokedById: admin.id,
    });
    expect(await db.auditLog.count({ where: { action: "trainer_invite.revoked", targetId: invite.inviteId } })).toBe(1);
    await expectInviteError(revokeTrainerInvite({ actorId: admin.id, inviteId: invite.inviteId }), "INVITE_NOT_PENDING");
  });

  it("resend revokes the old invite and issues a new token", async () => {
    const { admin, invite } = await setup();
    const resent = await resendTrainerInvite({ actorId: admin.id, inviteId: invite.inviteId });
    expect(resent.token).not.toBe(invite.token);
    expect(resent.email).toBe(invite.email);
    expect((await db.trainerInvite.findUniqueOrThrow({ where: { id: invite.inviteId } })).status).toBe("REVOKED");
    expect((await db.trainerInvite.findUniqueOrThrow({ where: { id: resent.inviteId } })).status).toBe("PENDING");
    expect(await findInviteByToken(invite.token)).toEqual({ state: "revoked" });
    expect((await findInviteByToken(resent.token)).state).toBe("valid");
  });

  it("can resend an expired invite but not an accepted one", async () => {
    const { admin, invite } = await setup();
    await db.$executeRaw`UPDATE trainer_invites SET status = 'EXPIRED' WHERE id = ${invite.inviteId}::uuid`;
    const resent = await resendTrainerInvite({ actorId: admin.id, inviteId: invite.inviteId });

    const member = await createUser({ email: invite.email });
    await acceptTrainerInvite({ userId: member.id, token: resent.token });
    await expectInviteError(resendTrainerInvite({ actorId: admin.id, inviteId: resent.inviteId }), "INVITE_NOT_PENDING");
  });

  it("rejects non-admin actors", async () => {
    const { invite } = await setup();
    const trainer = await createUser({ role: "TRAINER" });
    await expectInviteError(revokeTrainerInvite({ actorId: trainer.id, inviteId: invite.inviteId }), "ACTOR_NOT_ADMIN");
    await expectInviteError(resendTrainerInvite({ actorId: trainer.id, inviteId: invite.inviteId }), "ACTOR_NOT_ADMIN");
  });
});

describe("findInviteByToken", () => {
  it("reports and marks expired invites", async () => {
    const { invite } = await setup();
    expect(await findInviteByToken(invite.token)).toMatchObject({ state: "valid", email: invite.email });
    await db.$executeRaw`UPDATE trainer_invites SET created_at = now() - interval '8 days', expires_at = now() - interval '1 day' WHERE id = ${invite.inviteId}::uuid`;
    expect(await findInviteByToken(invite.token)).toEqual({ state: "expired" });
    expect((await db.trainerInvite.findUniqueOrThrow({ where: { id: invite.inviteId } })).status).toBe("EXPIRED");
    expect(await findInviteByToken("garbage")).toEqual({ state: "not_found" });
  });
});
