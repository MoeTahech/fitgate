import { describe, expect, it } from "vitest";
import type { AppRole } from "./constants";
import { AuthError, createGuards, type SessionUser } from "./guards";

function userWith(role: AppRole): SessionUser {
  return { id: `user-${role}`, name: "Test", email: `${role.toLowerCase()}@example.test`, role };
}

function guardsFor(user: SessionUser | null) {
  return createGuards(async () => user);
}

async function errorCode(promise: Promise<unknown>) {
  try {
    await promise;
    return null;
  } catch (error) {
    expect(error).toBeInstanceOf(AuthError);
    return (error as AuthError).code;
  }
}

describe("requireUser", () => {
  it("returns the signed-in user", async () => {
    const user = userWith("MEMBER");
    await expect(guardsFor(user).requireUser()).resolves.toEqual(user);
  });

  it("rejects when signed out", async () => {
    expect(await errorCode(guardsFor(null).requireUser())).toBe("UNAUTHENTICATED");
  });
});

describe("requireRole", () => {
  const cases: [AppRole, AppRole[], boolean][] = [
    ["MEMBER", ["ADMIN"], false],
    ["TRAINER", ["ADMIN"], false],
    ["ADMIN", ["ADMIN"], true],
    ["MEMBER", ["TRAINER", "ADMIN"], false],
    ["TRAINER", ["TRAINER", "ADMIN"], true],
    ["ADMIN", ["TRAINER", "ADMIN"], true],
    ["MEMBER", ["MEMBER"], true],
  ];

  it.each(cases)("%s against %j allowed=%s", async (role, allowed, expected) => {
    const result = guardsFor(userWith(role)).requireRole(...(allowed as [AppRole, ...AppRole[]]));
    if (expected) {
      await expect(result).resolves.toMatchObject({ role });
    } else {
      expect(await errorCode(result)).toBe("FORBIDDEN");
    }
  });

  it("reports signed-out before checking roles", async () => {
    expect(await errorCode(guardsFor(null).requireRole("ADMIN"))).toBe("UNAUTHENTICATED");
  });

  it("reads the session on every call", async () => {
    let current: SessionUser | null = userWith("ADMIN");
    const { requireRole } = createGuards(async () => current);
    await expect(requireRole("ADMIN")).resolves.toBeDefined();
    current = userWith("MEMBER");
    expect(await errorCode(requireRole("ADMIN"))).toBe("FORBIDDEN");
  });
});
