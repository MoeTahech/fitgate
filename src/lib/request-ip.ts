import "server-only";
import { headers } from "next/headers";
import { keyedHash } from "@/lib/crypto";

/** Keyed hash of the client IP from `x-forwarded-for` (set by Vercel), for audit rows. */
export async function getRequestIpHash(): Promise<string | null> {
  const ip = (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim();
  return ip ? keyedHash("ip", ip) : null;
}
