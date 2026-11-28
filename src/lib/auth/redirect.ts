import { emailSchema } from "./schemas";

const FALLBACK = "/";

/**
 * Returns `value` if it is a same-origin relative path (e.g. `/account?tab=1`), otherwise `fallback`.
 * Rejects absolute and protocol-relative URLs, backslashes, and control characters.
 */
export function safeRedirectPath(value: string | null | undefined, fallback = FALLBACK): string {
  if (!value || value.length > 2048) return fallback;
  if (!value.startsWith("/") || value.startsWith("//")) return fallback;
  if (/[\\\u0000-\u001f\u007f]/.test(value)) return fallback;

  try {
    const base = "http://fitgate.invalid";
    const url = new URL(value, base);
    if (url.origin !== base) return fallback;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return fallback;
  }
}

/** Where Better Auth sends the user after an email verification link (success or error). */
export function verificationCallbackURL(next: string): string {
  return `/verify-email?next=${encodeURIComponent(safeRedirectPath(next, "/account"))}`;
}

/** A valid email from a query parameter (normalised), else undefined; used to prefill sign-in and sign-up. */
export function prefillEmail(value: string | null | undefined): string | undefined {
  const parsed = emailSchema.safeParse(value ?? "");
  return parsed.success ? parsed.data : undefined;
}

/** Link to the sign-in or sign-up page that returns to `next`, optionally prefilling the email. */
export function authPageHref(path: "/sign-in" | "/sign-up", next: string, email?: string): string {
  const params = new URLSearchParams({ next });
  if (email) params.set("email", email);
  return `${path}?${params}`;
}
