export const AUTH_COOKIE_PREFIX = "fitgate";

export const VERIFICATION_TOKEN_TTL_SECONDS = 60 * 60;
export const PASSWORD_RESET_TOKEN_TTL_SECONDS = 60 * 60;

export const ROLES = ["MEMBER", "TRAINER", "ADMIN"] as const;
export type AppRole = (typeof ROLES)[number];

export const ROLE_LABELS: Record<AppRole, string> = { MEMBER: "Member", TRAINER: "Trainer", ADMIN: "Admin" };
