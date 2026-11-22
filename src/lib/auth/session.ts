import "server-only";
import { cacheLife } from "next/cache";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { cache } from "react";
import { ROLES, type AppRole } from "./constants";
import { AuthError, createGuards, type SessionUser } from "./guards";
import { safeRedirectPath } from "./redirect";
import { auth } from "./server";

export { AuthError, isAuthError, type SessionUser } from "./guards";

function toAppRole(value: unknown): AppRole {
  if (typeof value === "string" && (ROLES as readonly string[]).includes(value)) return value as AppRole;
  throw new Error("Session user has an unknown role");
}

/** Reads the session from the database on every request (cookie cache is disabled); deduplicated per request. */
const readSessionUser = cache(async (): Promise<SessionUser | null> => {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return null;
  const { id, name, email, role } = session.user;
  return { id, name, email, role: toAppRole(role) };
});

/** For server actions, route handlers, and data access. Throws `AuthError`. */
export const { requireUser, requireRole } = createGuards(readSessionUser);

/** For pages: redirects to sign-in when signed out, 404s on a missing role. */
export async function requirePageUser(returnTo: string, ...roles: AppRole[]): Promise<SessionUser> {
  try {
    return roles.length > 0 ? await requireRole(...(roles as [AppRole, ...AppRole[]])) : await requireUser();
  } catch (error) {
    if (error instanceof AuthError) {
      if (error.code === "UNAUTHENTICATED") {
        redirect(`/sign-in?next=${encodeURIComponent(safeRedirectPath(returnTo))}`);
      }
      notFound();
    }
    throw error;
  }
}

/**
 * Display only (headers, navigation). Browser-cached for a few minutes, so never use it for
 * authorization; call `requireUser`/`requireRole` instead. Render behind `<Suspense>`.
 */
export async function getCurrentUser(): Promise<SessionUser | null> {
  "use cache: private";
  cacheLife({ stale: 300 });
  return readSessionUser();
}
