import "server-only";
import { createHash, createHmac, randomBytes } from "node:crypto";
import { env } from "@/lib/env";

export type HashPurpose = "trial" | "rate-limit" | "ip";

export function generateToken(byteLength = 32): string {
  return randomBytes(byteLength).toString("base64url");
}

export function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function keyedHash(purpose: HashPurpose, value: string, secret: string = env.HASH_SECRET): string {
  return createHmac("sha256", secret).update(`fitgate:${purpose}:`, "utf8").update(value, "utf8").digest("hex");
}
