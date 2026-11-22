import type { AppRole } from "./constants";

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

  return { requireUser, requireRole };
}
