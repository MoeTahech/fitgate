import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { env } from "@/lib/env";
import { createEmailSender, EmailDeliveryError, type EmailTransport } from "./send";
import { smtpTransport } from "./transports";

const MAILPIT_API = `http://localhost:${process.env.MAILPIT_UI_PORT ?? "8025"}/api/v1`;

const message = {
  to: "member@example.test",
  subject: "Subject",
  text: "Open https://fitgate.app/reset?token=secret-token",
  html: "<p>Open</p>",
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("createEmailSender", () => {
  it("sends with the configured from address", async () => {
    const send = vi.fn<EmailTransport["send"]>().mockResolvedValue();
    await createEmailSender({ send }, "FitGate <no-reply@fitgate.local>")(message);
    expect(send).toHaveBeenCalledWith({ ...message, from: "FitGate <no-reply@fitgate.local>" });
  });

  it("throws a generic error and never logs the address or link", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const failure = Object.assign(new Error(`Recipient ${message.to} rejected: ${message.text}`), {
      code: "EENVELOPE",
      responseCode: 550,
    });
    const sender = createEmailSender({ send: () => Promise.reject(failure) }, "from@fitgate.local");

    const result = sender(message);
    await expect(result).rejects.toBeInstanceOf(EmailDeliveryError);
    await expect(result).rejects.toThrow(/^Email delivery failed$/);

    const output = JSON.stringify(logged.mock.calls);
    expect(output).toContain("EENVELOPE");
    expect(output).not.toContain(message.to);
    expect(output).not.toContain("secret-token");
  });
});

describe("smtpTransport", () => {
  it("delivers to the development SMTP server", async () => {
    if (env.EMAIL_TRANSPORT !== "smtp") throw new Error("EMAIL_TRANSPORT must be smtp for this test");
    const subject = `smtp-test ${randomUUID()}`;
    const sender = createEmailSender(smtpTransport({ host: env.SMTP_HOST, port: env.SMTP_PORT }), env.EMAIL_FROM);

    await sender({ ...message, subject });

    const query = encodeURIComponent(`subject:"${subject}"`);
    const found = (await (await fetch(`${MAILPIT_API}/search?query=${query}`)).json()) as {
      messages: { ID: string; To: { Address: string }[] }[];
    };
    expect(found.messages).toHaveLength(1);
    expect(found.messages[0].To[0].Address).toBe(message.to);

    await fetch(`${MAILPIT_API}/messages`, {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ IDs: found.messages.map(({ ID }) => ID) }),
    });
  });
});
