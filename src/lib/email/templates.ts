import "server-only";
import { formatLocal } from "@/lib/time";

export type EmailContent = { subject: string; text: string; html: string };

const APP_NAME = "FitGate";

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function greeting(name: string | undefined): string {
  const trimmed = name?.trim();
  return trimmed ? `Hi ${trimmed},` : "Hi,";
}

function formatDuration(minutes: number): string {
  if (minutes % 1440 === 0) {
    const days = minutes / 1440;
    return days === 1 ? "1 day" : `${days} days`;
  }
  if (minutes % 60 === 0) {
    const hours = minutes / 60;
    return hours === 1 ? "1 hour" : `${hours} hours`;
  }
  return minutes === 1 ? "1 minute" : `${minutes} minutes`;
}

type Layout = {
  subject: string;
  name?: string;
  paragraphs: string[];
  action: { label: string; url: string };
  footer: string;
};

function render({ subject, name, paragraphs, action, footer }: Layout): EmailContent {
  const text = [
    greeting(name),
    "",
    ...paragraphs.flatMap((paragraph) => [paragraph, ""]),
    `${action.label}: ${action.url}`,
    "",
    footer,
    "",
    `— ${APP_NAME}`,
  ].join("\n");

  const p = (content: string) => `<p style="margin:0 0 16px;line-height:1.5">${content}</p>`;
  const html = `<!doctype html>
<html lang="en">
  <body style="margin:0;padding:24px;background:#f4f4f5;font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;color:#18181b">
    <div style="max-width:480px;margin:0 auto;background:#ffffff;border-radius:8px;padding:32px">
      <h1 style="margin:0 0 24px;font-size:20px">${escapeHtml(subject)}</h1>
      ${p(escapeHtml(greeting(name)))}
      ${paragraphs.map((paragraph) => p(escapeHtml(paragraph))).join("\n      ")}
      <p style="margin:24px 0">
        <a href="${escapeHtml(action.url)}" style="display:inline-block;background:#18181b;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:6px">${escapeHtml(action.label)}</a>
      </p>
      <p style="margin:0 0 16px;line-height:1.5;font-size:13px;color:#52525b">If the button doesn't work, copy this link into your browser:<br><span style="word-break:break-all">${escapeHtml(action.url)}</span></p>
      <p style="margin:0;line-height:1.5;font-size:13px;color:#52525b">${escapeHtml(footer)}</p>
    </div>
  </body>
</html>`;

  return { subject, text, html };
}

export function verificationEmail(input: { name?: string; url: string; expiresInMinutes: number }): EmailContent {
  return render({
    subject: `Verify your ${APP_NAME} email`,
    name: input.name,
    paragraphs: [
      `Confirm your email address to finish setting up your ${APP_NAME} account.`,
      `This link expires in ${formatDuration(input.expiresInMinutes)}.`,
    ],
    action: { label: "Verify email", url: input.url },
    footer: "If you didn't create an account, you can ignore this email.",
  });
}

export function passwordResetEmail(input: { name?: string; url: string; expiresInMinutes: number }): EmailContent {
  return render({
    subject: `Reset your ${APP_NAME} password`,
    name: input.name,
    paragraphs: [
      "We received a request to reset your password.",
      `This link expires in ${formatDuration(input.expiresInMinutes)} and can be used once. Resetting signs you out on all devices.`,
    ],
    action: { label: "Reset password", url: input.url },
    footer: "If you didn't request this, you can ignore this email. Your password stays the same.",
  });
}

export function alreadyRegisteredEmail(input: { name?: string; resetUrl: string }): EmailContent {
  return render({
    subject: `You already have a ${APP_NAME} account`,
    name: input.name,
    paragraphs: [
      "Someone tried to create an account with this email address, but you already have one.",
      "If that was you, sign in with your existing password, or reset it if you've forgotten it.",
    ],
    action: { label: "Reset password", url: input.resetUrl },
    footer: "If this wasn't you, no action is needed. Your account hasn't changed.",
  });
}

export function trainerInviteEmail(input: { url: string; expiresAt: Date; timeZone: string }): EmailContent {
  const expires = formatLocal(input.expiresAt, input.timeZone, { dateStyle: "long", timeStyle: "short" });

  return render({
    subject: `You're invited to join ${APP_NAME} as a trainer`,
    paragraphs: [
      `You've been invited to join ${APP_NAME} as a trainer.`,
      `Sign in or create an account with this email address to accept. The invite expires on ${expires}.`,
    ],
    action: { label: "Accept invite", url: input.url },
    footer: "If you weren't expecting this, you can ignore this email.",
  });
}

export function membershipInviteEmail(input: {
  url: string;
  inviterName: string;
  planName: string;
  expiresAt: Date;
  timeZone: string;
}): EmailContent {
  const expires = formatLocal(input.expiresAt, input.timeZone, { dateStyle: "long", timeStyle: "short" });

  return render({
    subject: `You're invited to share a ${APP_NAME} membership`,
    paragraphs: [
      `${input.inviterName.trim()} invited you to share their ${input.planName} membership at ${APP_NAME}.`,
      `Sign in or create an account with this email address to accept. The invite expires on ${expires}.`,
    ],
    action: { label: "Accept invite", url: input.url },
    footer: "If you weren't expecting this, you can ignore this email.",
  });
}
