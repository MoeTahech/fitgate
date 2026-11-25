import type { InviteFormState } from "./actions";

export type InviteIntent = "revoke" | "resend";
export type InviteTarget = { intent: InviteIntent; inviteId: string; email: string };
/** Result of the invite row action that ran last, whichever row and action it was. */
export type InviteResult = InviteFormState & { intent?: InviteIntent; email?: string };

export type InviteResultMessage = { tone: "info" | "success" | "error"; text: string };

const PENDING: Record<InviteIntent, (email: string) => string> = {
  revoke: (email) => `Revoking the invite to ${email}…`,
  resend: (email) => `Sending the invite to ${email} again…`,
};

const SUCCESS: Record<InviteIntent, (email: string) => string> = {
  revoke: (email) => `Invite to ${email} revoked.`,
  resend: (email) => `Invite to ${email} sent again.`,
};

const FAILED: Record<InviteIntent, string> = { revoke: "Revoke", resend: "Resend" };

export function describeInviteResult(result: InviteResult, pending: InviteTarget | null): InviteResultMessage | null {
  if (pending) return { tone: "info", text: PENDING[pending.intent](pending.email) };
  if (result.status === "idle" || !result.intent || !result.email) return null;
  if (result.status === "success") return { tone: "success", text: SUCCESS[result.intent](result.email) };
  return { tone: "error", text: `${FAILED[result.intent]} failed for ${result.email}: ${result.message ?? "Something went wrong. Please try again."}` };
}
