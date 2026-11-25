import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { resetDatabase } from "../../../../tests/support/database";
import {
  createFreeze,
  createManualPayment,
  createMembership,
  createPlan,
  createSeat,
  createUser,
} from "../../../../tests/support/factories";
import { MembershipError, toMembershipError, violatedUniqueIndex } from "./errors";

beforeEach(async () => {
  await resetDatabase();
});

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => {
      throw new Error("Expected the promise to reject");
    },
    (reason: unknown) => reason,
  );
}

async function memberWithBase() {
  const user = await createUser();
  const plan = await createPlan();
  const membership = await createMembership(user.id, plan.id);
  await createSeat(membership.id, user.id);
  return { user, plan, membership };
}

describe("toMembershipError", () => {
  it("maps a second open base seat from a model call to HAS_ACTIVE_BASE", async () => {
    const { user, plan } = await memberWithBase();
    const other = await createMembership(user.id, plan.id);

    const error = await rejection(createSeat(other.id, user.id));

    expect(violatedUniqueIndex(error)).toBe("membership_members_one_active_base_key");
    const mapped = toMembershipError(error);
    expect(mapped).toBeInstanceOf(MembershipError);
    expect((mapped as MembershipError).code).toBe("HAS_ACTIVE_BASE");
  });

  it("maps the same violation from a raw query", async () => {
    const { user, plan } = await memberWithBase();
    const other = await createMembership(user.id, plan.id);

    const error = await rejection(db.$executeRaw`
      INSERT INTO membership_members (id, membership_id, user_id, role, plan_type, joined_at)
      VALUES (gen_random_uuid(), ${other.id}::uuid, ${user.id}, 'OWNER', 'BASE', ${new Date()})
    `);

    expect((toMembershipError(error) as MembershipError).code).toBe("HAS_ACTIVE_BASE");
  });

  it("maps a duplicate method and reference to DUPLICATE_REFERENCE", async () => {
    const admin = await createUser({ role: "ADMIN" });
    const { membership } = await memberWithBase();
    await createManualPayment(membership, admin.id, { reference: "TX-1" });

    const error = await rejection(createManualPayment(membership, admin.id, { reference: "TX-1" }));

    expect((toMembershipError(error) as MembershipError).code).toBe("DUPLICATE_REFERENCE");
  });

  it("maps a second open freeze to FREEZE_ALREADY_OPEN", async () => {
    const { user, membership } = await memberWithBase();
    await createFreeze(membership.id, user.id);

    const error = await rejection(createFreeze(membership.id, user.id));

    expect((toMembershipError(error) as MembershipError).code).toBe("FREEZE_ALREADY_OPEN");
  });

  it("returns other errors unchanged", async () => {
    const user = await createUser();
    const duplicateEmail = await rejection(createUser({ email: user.email }));
    expect(toMembershipError(duplicateEmail)).toBe(duplicateEmail);

    const plain = new Error("boom");
    expect(toMembershipError(plain)).toBe(plain);
    expect(violatedUniqueIndex(plain)).toBeNull();
  });
});
