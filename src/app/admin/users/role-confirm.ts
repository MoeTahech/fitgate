import { ROLES, type AppRole } from "@/lib/auth/constants";

/** Saving would take the current admin's own admin role away, which signs them out everywhere. */
export function needsSelfDemotionConfirm({ isSelf, selected }: { isSelf: boolean; selected: AppRole }): boolean {
  return isSelf && selected !== "ADMIN";
}

export function parseRole(value: string): AppRole | null {
  return ROLES.find((role) => role === value) ?? null;
}
