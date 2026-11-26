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

async function thrownDigest(promise: Promise<unknown>): Promise<string> {
  const error = await promise.then(
    () => null,
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(Error);
  const digest = (error as Error & { digest?: unknown }).digest;
  expect(typeof digest).toBe("string");
  return digest as string;
}

function redirectTarget(digest: string): string {
  const [code, , url] = digest.split(";");
  expect(code).toBe("NEXT_REDIRECT");
  return url;
}

const NOT_FOUND_DIGEST = "NEXT_HTTP_ERROR_FALLBACK;404";

describe("requirePageUser", () => {
  it("returns any signed-in user when no role is required", async () => {
    const user = userWith("MEMBER");
    await expect(guardsFor(user).requirePageUser("/account")).resolves.toEqual(user);
  });

  it("returns the user when the role matches", async () => {
    const user = userWith("ADMIN");
    await expect(guardsFor(user).requirePageUser("/admin/members", "ADMIN")).resolves.toEqual(user);
  });

  it("redirects a signed-out visitor to sign-in with the return path", async () => {
    const digest = await thrownDigest(guardsFor(null).requirePageUser("/admin/members?q=ann", "ADMIN"));
    expect(redirectTarget(digest)).toBe(`/sign-in?next=${encodeURIComponent("/admin/members?q=ann")}`);
  });

  it("drops an unsafe return path", async () => {
    const digest = await thrownDigest(guardsFor(null).requirePageUser("//evil.example/x"));
    expect(redirectTarget(digest)).toBe(`/sign-in?next=${encodeURIComponent("/")}`);
  });

  it.each(["MEMBER", "TRAINER"] as const)("404s for %s on an admin page", async (role) => {
    expect(await thrownDigest(guardsFor(userWith(role)).requirePageUser("/admin/members", "ADMIN"))).toBe(NOT_FOUND_DIGEST);
  });

  it("rethrows errors that are not auth errors", async () => {
    const failure = new Error("database down");
    const { requirePageUser } = createGuards(async () => {
      throw failure;
    });
    await expect(requirePageUser("/account")).rejects.toBe(failure);
  });
});
