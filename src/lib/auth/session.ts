import "server-only";
import { cacheLife, io } from "next/cache";
import { headers } from "next/headers";
import { cache } from "react";
import { ROLES, type AppRole } from "./constants";
import { createGuards, type SessionUser } from "./guards";
import { auth } from "./server";

export { AuthError, isAuthError, type SessionUser } from "./guards";

function toAppRole(value: unknown): AppRole {
  if (typeof value === "string" && (ROLES as readonly string[]).includes(value)) return value as AppRole;
  throw new Error("Session user has an unknown role");
}

/** Reads the session from the database on every request (cookie cache is disabled); deduplicated per request. */
const readSessionUser = cache(async (): Promise<SessionUser | null> => {
  const requestHeaders = await headers();
  // Prefetch prerenders can read headers, so they are no suspension point there. Session validation
  // compares expiry with the current time; io() keeps it out of prerenders (a no-op in cached scopes).
  await io();
  const session = await auth.api.getSession({ headers: requestHeaders });
  if (!session) return null;
  const { id, name, email, role } = session.user;
  return { id, name, email, role: toAppRole(role) };
});

/** Uncached session read that returns null when signed out; safe for authorization decisions. */
export const getSessionUser = readSessionUser;

/**
 * `requireUser`/`requireRole` for server actions, route handlers, and data access (throw
 * `AuthError`); `requirePageUser` for pages (sign-in redirect when signed out, 404 on a missing role).
 */
export const { requireUser, requireRole, requirePageUser } = createGuards(readSessionUser);

/**
 * Display only (headers, navigation). Browser-cached for a few minutes, so never use it for
 * authorization; call `requireUser`/`requireRole` instead. Render behind `<Suspense>`.
 */
export async function getCurrentUser(): Promise<SessionUser | null> {
  "use cache: private";
  cacheLife({ stale: 300 });
  return readSessionUser();
}
