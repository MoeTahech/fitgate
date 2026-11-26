import "server-only";
import { headers } from "next/headers";
import { keyedHash } from "@/lib/crypto";

/**
 * The client IP: the first `x-forwarded-for` address (set by Vercel), or null.
 *
 * Raw IPs are personal data. The only use is the trial rate-limit identifier (`startTrial`'s
 * `ip`, which the limiter hashes before it reaches Redis). Never store it in the database, write
 * it to audit rows, or log it; audit rows take `getRequestIpHash()`.
 */
export async function getRequestIp(): Promise<string | null> {
  const ip = (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim();
  return ip ? ip : null;
}

/** Keyed hash of the client IP from `x-forwarded-for`, for audit rows. */
export async function getRequestIpHash(): Promise<string | null> {
  const ip = await getRequestIp();
  return ip ? keyedHash("ip", ip) : null;
}
