import { randomBytes } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { resetDatabase } from "../support/database";
import { createUser } from "../support/factories";

const DAY_MS = 24 * 60 * 60 * 1000;

beforeEach(async () => {
  await resetDatabase();
});

describe("users", () => {
  it("rejects emails that are not lowercase", async () => {
    await expect(createUser({ email: "Alice@Example.test" })).rejects.toThrow(/users_email_lower_check/);
    await expect(createUser({ email: "alice@example.test" })).resolves.toBeDefined();
  });
});

describe("users_last_admin_guard", () => {
  const lastAdminError = /users_last_admin_guard|active admin must remain/;

  it("blocks demoting the last active admin", async () => {
    const admin = await createUser({ role: "ADMIN" });
    await expect(
      db.$executeRaw`UPDATE users SET role = 'MEMBER' WHERE id = ${admin.id}`,
    ).rejects.toThrow(lastAdminError);
    expect((await db.user.findUniqueOrThrow({ where: { id: admin.id } })).role).toBe("ADMIN");
  });

  it("blocks anonymizing the last active admin", async () => {
    const admin = await createUser({ role: "ADMIN" });
    await expect(
      db.$executeRaw`UPDATE users SET anonymized_at = now() WHERE id = ${admin.id}`,
    ).rejects.toThrow(lastAdminError);
  });

  it("blocks deleting the last active admin", async () => {
    const admin = await createUser({ role: "ADMIN" });
    await expect(db.$executeRaw`DELETE FROM users WHERE id = ${admin.id}`).rejects.toThrow(
      lastAdminError,
    );
  });

  it("blocks demoting every admin in one statement", async () => {
    await createUser({ role: "ADMIN" });
    await createUser({ role: "ADMIN" });
    await expect(
      db.$executeRaw`UPDATE users SET role = 'MEMBER' WHERE role = 'ADMIN'`,
    ).rejects.toThrow(lastAdminError);
    expect(await db.user.count({ where: { role: "ADMIN" } })).toBe(2);
  });

  it("allows demoting an admin while another active admin remains", async () => {
    const first = await createUser({ role: "ADMIN" });
    await createUser({ role: "ADMIN" });
    await expect(
      db.$executeRaw`UPDATE users SET role = 'MEMBER' WHERE id = ${first.id}`,
    ).resolves.toBe(1);
  });

  it("does not count an anonymized admin as remaining", async () => {
    const active = await createUser({ role: "ADMIN" });
    const other = await createUser({ role: "ADMIN" });
    await db.$executeRaw`UPDATE users SET anonymized_at = now() WHERE id = ${other.id}`;
    await expect(
      db.$executeRaw`UPDATE users SET role = 'MEMBER' WHERE id = ${active.id}`,
    ).rejects.toThrow(lastAdminError);
  });

  it("allows other updates to the last admin", async () => {
    const admin = await createUser({ role: "ADMIN" });
    await expect(
      db.$executeRaw`UPDATE users SET name = 'Renamed' WHERE id = ${admin.id}`,
    ).resolves.toBe(1);
  });

  it("allows role changes and deletes before any admin exists", async () => {
    const user = await createUser();
    await expect(
      db.$executeRaw`UPDATE users SET role = 'TRAINER' WHERE id = ${user.id}`,
    ).resolves.toBe(1);
    await expect(db.$executeRaw`DELETE FROM users WHERE id = ${user.id}`).resolves.toBe(1);
  });
});

describe("trainer_invites", () => {
  async function insertInvite(values: {
    email?: string;
    status?: "PENDING" | "ACCEPTED" | "REVOKED" | "EXPIRED";
    invitedById: string;
    acceptedById?: string | null;
    acceptedAt?: Date | null;
    revokedById?: string | null;
    revokedAt?: Date | null;
    expiresAt?: Date;
  }) {
    return db.trainerInvite.create({
      data: {
        email: values.email ?? "coach@example.test",
        tokenHash: randomBytes(32).toString("hex"),
        status: values.status ?? "PENDING",
        invitedById: values.invitedById,
        acceptedById: values.acceptedById ?? null,
        acceptedAt: values.acceptedAt ?? null,
        revokedById: values.revokedById ?? null,
        revokedAt: values.revokedAt ?? null,
        expiresAt: values.expiresAt ?? new Date(Date.now() + 7 * DAY_MS),
      },
    });
  }

  it("rejects emails that are not lowercase", async () => {
    const admin = await createUser({ role: "ADMIN" });
    await expect(insertInvite({ invitedById: admin.id, email: "Coach@example.test" })).rejects.toThrow(/trainer_invites_email_check/);
  });

  it("rejects an expiry that is not after creation", async () => {
    const admin = await createUser({ role: "ADMIN" });
    await expect(
      insertInvite({ invitedById: admin.id, expiresAt: new Date(Date.now() - DAY_MS) }),
    ).rejects.toThrow(/trainer_invites_expiry_check/);
  });

  it("requires acceptance details exactly when ACCEPTED", async () => {
    const admin = await createUser({ role: "ADMIN" });
    const trainer = await createUser({ role: "TRAINER" });
    await expect(insertInvite({ invitedById: admin.id, status: "ACCEPTED" })).rejects.toThrow(/trainer_invites_accepted_check/);
    await expect(
      insertInvite({ invitedById: admin.id, acceptedById: trainer.id, acceptedAt: new Date() }),
    ).rejects.toThrow(/trainer_invites_accepted_check/);
    await expect(
      insertInvite({
        invitedById: admin.id,
        status: "ACCEPTED",
        acceptedById: trainer.id,
        acceptedAt: new Date(),
      }),
    ).resolves.toBeDefined();
  });

  it("requires revocation details exactly when REVOKED", async () => {
    const admin = await createUser({ role: "ADMIN" });
    await expect(insertInvite({ invitedById: admin.id, status: "REVOKED" })).rejects.toThrow(/trainer_invites_revoked_check/);
    await expect(
      insertInvite({ invitedById: admin.id, revokedById: admin.id, revokedAt: new Date() }),
    ).rejects.toThrow(/trainer_invites_revoked_check/);
    await expect(
      insertInvite({
        invitedById: admin.id,
        status: "REVOKED",
        revokedById: admin.id,
        revokedAt: new Date(),
      }),
    ).resolves.toBeDefined();
  });

  it("allows only one pending invite per email", async () => {
    const admin = await createUser({ role: "ADMIN" });
    await insertInvite({
      invitedById: admin.id,
      status: "REVOKED",
      revokedById: admin.id,
      revokedAt: new Date(),
    });
    await insertInvite({ invitedById: admin.id });
    await expect(insertInvite({ invitedById: admin.id })).rejects.toThrow(/Unique constraint failed/);
    await expect(
      insertInvite({ invitedById: admin.id, email: "other@example.test" }),
    ).resolves.toBeDefined();
  });
});
