import { describe, expect, it } from "vitest";
import { describeInviteResult, type InviteResult, type InviteTarget } from "./invite-results";

const EMAIL = "coach@example.com";
const target = (intent: InviteTarget["intent"]): InviteTarget => ({ intent, inviteId: "invite-1", email: EMAIL });

describe("describeInviteResult", () => {
  it("shows nothing before any action ran", () => {
    expect(describeInviteResult({ status: "idle" }, null)).toBeNull();
  });

  it.each([
    ["revoke", "Revoking the invite to coach@example.com…"],
    ["resend", "Sending the invite to coach@example.com again…"],
  ] as const)("describes a pending %s", (intent, text) => {
    expect(describeInviteResult({ status: "idle" }, target(intent))).toEqual({ tone: "info", text });
  });

  it("prefers the pending action over the previous result", () => {
    const previous: InviteResult = { status: "error", message: "Nope.", intent: "resend", email: EMAIL };
    expect(describeInviteResult(previous, target("revoke"))?.tone).toBe("info");
  });

  it.each([
    ["revoke", "Invite to coach@example.com revoked."],
    ["resend", "Invite to coach@example.com sent again."],
  ] as const)("describes a successful %s", (intent, text) => {
    expect(describeInviteResult({ status: "success", message: "Invite sent.", intent, email: EMAIL }, null)).toEqual({
      tone: "success",
      text,
    });
  });

  it.each([
    ["revoke", "Revoke failed for coach@example.com: This invite is no longer pending."],
    ["resend", "Resend failed for coach@example.com: This invite is no longer pending."],
  ] as const)("names the failed %s and keeps the server message", (intent, text) => {
    const result: InviteResult = { status: "error", message: "This invite is no longer pending.", intent, email: EMAIL };
    expect(describeInviteResult(result, null)).toEqual({ tone: "error", text });
  });

  it("shows a revoke error that follows a successful resend", () => {
    const afterResend: InviteResult = { status: "success", message: "Invite sent.", intent: "resend", email: EMAIL };
    const afterRevoke: InviteResult = { status: "error", message: "This invite no longer exists.", intent: "revoke", email: EMAIL };
    expect(describeInviteResult(afterResend, null)?.tone).toBe("success");
    expect(describeInviteResult(afterRevoke, null)).toEqual({
      tone: "error",
      text: "Revoke failed for coach@example.com: This invite no longer exists.",
    });
  });
});
