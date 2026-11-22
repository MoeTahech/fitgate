import { describe, expect, it } from "vitest";
import {
  alreadyRegisteredEmail,
  passwordResetEmail,
  trainerInviteEmail,
  verificationEmail,
} from "./templates";

const url = "https://fitgate.app/verify?token=abc&callbackURL=%2Faccount";

describe("email templates", () => {
  it("include the link in text and HTML, escaped in HTML", () => {
    const email = verificationEmail({ name: "Sam", url, expiresInMinutes: 60 });
    expect(email.text).toContain(url);
    expect(email.html).toContain('href="https://fitgate.app/verify?token=abc&amp;callbackURL=%2Faccount"');
    expect(email.text).toContain("1 hour");
  });

  it("escape user-supplied names in HTML", () => {
    const email = passwordResetEmail({ name: '<img src=x onerror="alert(1)">', url, expiresInMinutes: 60 });
    expect(email.html).not.toContain("<img");
    expect(email.html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
  });

  it("fall back to a neutral greeting without a name", () => {
    expect(alreadyRegisteredEmail({ name: "  ", resetUrl: url }).text.startsWith("Hi,\n")).toBe(true);
  });

  it("format the trainer invite expiry in the gym time zone", () => {
    const email = trainerInviteEmail({
      url,
      expiresAt: new Date("2026-07-01T21:30:00Z"),
      timeZone: "Asia/Beirut",
    });
    expect(email.text).toContain("2 July 2026 at 00:30");
  });
});
