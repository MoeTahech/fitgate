import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { resetDatabase } from "../../../tests/support/database";
import {
  createClassSession,
  createClassTemplate,
  createSession,
  createUser,
} from "../../../tests/support/factories";
import { changeUserRole, RoleChangeError, type RoleChangeErrorCode } from "./roles";

beforeEach(async () => {
  await resetDatabase();
});

async function expectRoleError(promise: Promise<unknown>, code: RoleChangeErrorCode) {
  const error = await promise.then(
    () => null,
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(RoleChangeError);
  expect((error as RoleChangeError).code).toBe(code);
}

async function roleOf(id: string) {
  return (await db.user.findUniqueOrThrow({ where: { id } })).role;
}

describe("changeUserRole", () => {
  it("promotes a member and writes an audit row in the same change", async () => {
    const admin = await createUser({ role: "ADMIN" });
    const member = await createUser();
    await createSession(member.id);

    const result = await changeUserRole({ actorId: admin.id, targetUserId: member.id, newRole: "TRAINER", ipHash: "iphash" });

    expect(result).toEqual({ changed: true, from: "MEMBER", to: "TRAINER" });
    expect(await roleOf(member.id)).toBe("TRAINER");
    expect(await db.session.count({ where: { userId: member.id } })).toBe(1);
    const audit = await db.auditLog.findMany();
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      actorId: admin.id,
      action: "user.role_changed",
      targetType: "user",
      targetId: member.id,
      details: { from: "MEMBER", to: "TRAINER" },
      ipHash: "iphash",
    });
  });

  it("is a no-op without an audit row when the role is unchanged", async () => {
    const admin = await createUser({ role: "ADMIN" });
    const trainer = await createUser({ role: "TRAINER" });
    expect(await changeUserRole({ actorId: admin.id, targetUserId: trainer.id, newRole: "TRAINER" })).toEqual({
      changed: false,
      from: "TRAINER",
      to: "TRAINER",
    });
    expect(await db.auditLog.count()).toBe(0);
  });

  it("revokes the target's sessions on a demotion", async () => {
    const admin = await createUser({ role: "ADMIN" });
    const otherAdmin = await createUser({ role: "ADMIN" });
    await createSession(otherAdmin.id);
    await createSession(otherAdmin.id);

    await changeUserRole({ actorId: admin.id, targetUserId: otherAdmin.id, newRole: "TRAINER" });

    expect(await roleOf(otherAdmin.id)).toBe("TRAINER");
    expect(await db.session.count({ where: { userId: otherAdmin.id } })).toBe(0);
    expect((await db.auditLog.findFirstOrThrow()).details).toEqual({ from: "ADMIN", to: "TRAINER" });
  });

  it("rejects actors who are not active admins", async () => {
    const trainer = await createUser({ role: "TRAINER" });
    const member = await createUser();
    const anonymizedAdmin = await createUser({ role: "ADMIN", anonymizedAt: new Date() });
    await createUser({ role: "ADMIN" });

    await expectRoleError(changeUserRole({ actorId: trainer.id, targetUserId: member.id, newRole: "TRAINER" }), "ACTOR_NOT_ADMIN");
    await expectRoleError(changeUserRole({ actorId: member.id, targetUserId: member.id, newRole: "ADMIN" }), "ACTOR_NOT_ADMIN");
    await expectRoleError(
      changeUserRole({ actorId: anonymizedAdmin.id, targetUserId: member.id, newRole: "TRAINER" }),
      "ACTOR_NOT_ADMIN",
    );
    await expectRoleError(changeUserRole({ actorId: "missing", targetUserId: member.id, newRole: "TRAINER" }), "ACTOR_NOT_ADMIN");
    expect(await roleOf(member.id)).toBe("MEMBER");
    expect(await db.auditLog.count()).toBe(0);
  });

  it("rejects missing and anonymized targets", async () => {
    const admin = await createUser({ role: "ADMIN" });
    const anonymized = await createUser({ anonymizedAt: new Date() });
    await expectRoleError(changeUserRole({ actorId: admin.id, targetUserId: "missing", newRole: "TRAINER" }), "TARGET_NOT_FOUND");
    await expectRoleError(
      changeUserRole({ actorId: admin.id, targetUserId: anonymized.id, newRole: "TRAINER" }),
      "TARGET_ANONYMIZED",
    );
  });

  it("validates input", async () => {
    await expect(changeUserRole({ actorId: "a", targetUserId: "b", newRole: "OWNER" as never })).rejects.toThrow();
    await expect(changeUserRole({ actorId: "", targetUserId: "b", newRole: "ADMIN" })).rejects.toThrow();
  });

  describe("last-admin rule", () => {
    it("rejects demoting the last active admin, including self-demotion", async () => {
      const admin = await createUser({ role: "ADMIN" });
      await createUser({ role: "ADMIN", anonymizedAt: new Date() });
      await expectRoleError(changeUserRole({ actorId: admin.id, targetUserId: admin.id, newRole: "MEMBER" }), "LAST_ADMIN");
      expect(await roleOf(admin.id)).toBe("ADMIN");
    });

    it("allows demoting an admin while another remains", async () => {
      const first = await createUser({ role: "ADMIN" });
      const second = await createUser({ role: "ADMIN" });
      await changeUserRole({ actorId: first.id, targetUserId: first.id, newRole: "MEMBER" });
      expect(await roleOf(first.id)).toBe("MEMBER");
      expect(await roleOf(second.id)).toBe("ADMIN");
    });

    it("leaves exactly one admin when the only two demote themselves concurrently", async () => {
      const first = await createUser({ role: "ADMIN" });
      const second = await createUser({ role: "ADMIN" });

      const results = await Promise.allSettled([
        changeUserRole({ actorId: first.id, targetUserId: first.id, newRole: "MEMBER" }),
        changeUserRole({ actorId: second.id, targetUserId: second.id, newRole: "MEMBER" }),
      ]);

      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      const rejected = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
      expect((rejected.reason as RoleChangeError).code).toBe("LAST_ADMIN");
      expect(await db.user.count({ where: { role: "ADMIN" } })).toBe(1);
      expect(await db.auditLog.count()).toBe(1);
    });

    it("leaves exactly one admin when the only two demote each other concurrently", async () => {
      const first = await createUser({ role: "ADMIN" });
      const second = await createUser({ role: "ADMIN" });

      const results = await Promise.allSettled([
        changeUserRole({ actorId: first.id, targetUserId: second.id, newRole: "MEMBER" }),
        changeUserRole({ actorId: second.id, targetUserId: first.id, newRole: "MEMBER" }),
      ]);

      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect(await db.user.count({ where: { role: "ADMIN" } })).toBe(1);
    });
  });

  describe("demotion to member with classes", () => {
    it("rejects while the person has an upcoming scheduled session", async () => {
      const admin = await createUser({ role: "ADMIN" });
      const trainer = await createUser({ role: "TRAINER" });
      const template = await createClassTemplate(trainer.id, { active: false });
      await createClassSession(template.id, trainer.id);
      await expectRoleError(
        changeUserRole({ actorId: admin.id, targetUserId: trainer.id, newRole: "MEMBER" }),
        "HAS_UPCOMING_CLASSES",
      );
      expect(await roleOf(trainer.id)).toBe("TRAINER");
    });

    it("rejects while the person has an active class template", async () => {
      const admin = await createUser({ role: "ADMIN" });
      const trainer = await createUser({ role: "TRAINER" });
      await createClassTemplate(trainer.id);
      await expectRoleError(
        changeUserRole({ actorId: admin.id, targetUserId: trainer.id, newRole: "MEMBER" }),
        "HAS_UPCOMING_CLASSES",
      );
    });

    it("allows it with only past or cancelled sessions and inactive templates", async () => {
      const admin = await createUser({ role: "ADMIN" });
      const trainer = await createUser({ role: "TRAINER" });
      const template = await createClassTemplate(trainer.id, { active: false });
      await createClassSession(template.id, trainer.id, { startsAt: new Date(Date.now() - 48 * 3600_000) });
      await createClassSession(template.id, trainer.id, { status: "CANCELLED" });
      await changeUserRole({ actorId: admin.id, targetUserId: trainer.id, newRole: "MEMBER" });
      expect(await roleOf(trainer.id)).toBe("MEMBER");
    });

    it("does not block a trainer from becoming an admin", async () => {
      const admin = await createUser({ role: "ADMIN" });
      const trainer = await createUser({ role: "TRAINER" });
      await createClassTemplate(trainer.id);
      await changeUserRole({ actorId: admin.id, targetUserId: trainer.id, newRole: "ADMIN" });
      expect(await roleOf(trainer.id)).toBe("ADMIN");
    });
  });
});
