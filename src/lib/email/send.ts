import "server-only";
import { env } from "@/lib/env";
import { consoleTransport, smtpTransport } from "./transports";

export type EmailMessage = {
  to: string;
  subject: string;
  text: string;
  html: string;
};

export type OutgoingEmail = EmailMessage & { from: string };

export interface EmailTransport {
  send(email: OutgoingEmail): Promise<void>;
}

export class EmailDeliveryError extends Error {
  constructor() {
    super("Email delivery failed");
    this.name = "EmailDeliveryError";
  }
}

function describeFailure(error: unknown): Record<string, unknown> {
  if (typeof error !== "object" || error === null) return { type: typeof error };
  const { name, code, responseCode, command } = error as Record<string, unknown>;
  return { name, code, responseCode, command };
}

export function createEmailSender(transport: EmailTransport, from: string) {
  return async function send(message: EmailMessage): Promise<void> {
    try {
      await transport.send({ ...message, from });
    } catch (error) {
      console.error("[email] delivery failed", describeFailure(error));
      throw new EmailDeliveryError();
    }
  };
}

let defaultSender: ((message: EmailMessage) => Promise<void>) | undefined;

function getDefaultSender() {
  if (!defaultSender) {
    const transport =
      env.EMAIL_TRANSPORT === "smtp"
        ? smtpTransport({ host: env.SMTP_HOST, port: env.SMTP_PORT })
        : consoleTransport();
    defaultSender = createEmailSender(transport, env.EMAIL_FROM);
  }
  return defaultSender;
}

export function sendEmail(message: EmailMessage): Promise<void> {
  return getDefaultSender()(message);
}
