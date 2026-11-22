import "server-only";
import { createTransport } from "nodemailer";
import type { EmailTransport } from "./send";

export function smtpTransport(options: { host: string; port: number }): EmailTransport {
  const transporter = createTransport({
    host: options.host,
    port: options.port,
    secure: options.port === 465,
  });

  return {
    async send(email) {
      await transporter.sendMail({
        from: email.from,
        to: email.to,
        subject: email.subject,
        text: email.text,
        html: email.html,
      });
    },
  };
}

/** Development mailbox: prints the plain-text email to stdout. Rejected in production by env validation. */
export function consoleTransport(): EmailTransport {
  return {
    async send(email) {
      console.info(
        ["", "──── email ────", `To: ${email.to}`, `Subject: ${email.subject}`, "", email.text, "───────────────", ""].join("\n"),
      );
    },
  };
}
