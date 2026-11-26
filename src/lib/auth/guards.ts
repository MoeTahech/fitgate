import { notFound, redirect } from "next/navigation";
import type { AppRole } from "./constants";
import { safeRedirectPath } from "./redirect";

export type SessionUser = {
  id: string;
  name: string;
  email: string;
  role: AppRole;
};

export type SessionSource = () => Promise<SessionUser | null>;

export type AuthErrorCode = "UNAUTHENTICATED" | "FORBIDDEN";

export class AuthError extends Error {
  readonly code: AuthErrorCode;

  constructor(code: AuthErrorCode) {
    super(code === "UNAUTHENTICATED" ? "Authentication required" : "Insufficient permissions");
    this.name = "AuthError";
    this.code = code;
  }
}

export function isAuthError(error: unknown): error is AuthError {
  return error instanceof AuthError;
}

export function createGuards(getSessionUser: SessionSource) {
  async function requireUser(): Promise<SessionUser> {
    const user = await getSessionUser();
    if (!user) throw new AuthError("UNAUTHENTICATED");
    return user;
  }

  async function requireRole(...roles: [AppRole, ...AppRole[]]): Promise<SessionUser> {
    const user = await requireUser();
    if (!roles.includes(user.role)) throw new AuthError("FORBIDDEN");
    return user;
  }

  /** For pages: redirects to sign-in when signed out, 404s on a missing role. */
  async function requirePageUser(returnTo: string, ...roles: AppRole[]): Promise<SessionUser> {
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

  return { requireUser, requireRole, requirePageUser };
}
