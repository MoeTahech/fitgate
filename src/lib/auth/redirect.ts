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
