import "server-only";
import { z } from "zod";

const secret = z.string().min(32, "must be at least 32 characters");
const httpUrl = z.url({ protocol: /^https?$/ });

const baseSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  BETTER_AUTH_SECRET: secret,
  BETTER_AUTH_URL: httpUrl.transform((value) => value.replace(/\/+$/, "")),
  HASH_SECRET: secret,
  UPSTASH_REDIS_REST_URL: httpUrl,
  UPSTASH_REDIS_REST_TOKEN: z.string().min(1),
  EMAIL_FROM: z.string().min(3),
});

const emailTransportSchema = z.discriminatedUnion("EMAIL_TRANSPORT", [
  z.object({
    EMAIL_TRANSPORT: z.literal("smtp"),
    SMTP_HOST: z.string().min(1),
    SMTP_PORT: z.coerce.number().int().min(1).max(65535),
  }),
  z.object({ EMAIL_TRANSPORT: z.literal("console") }),
]);

const envSchema = z.intersection(baseSchema, emailTransportSchema).superRefine((env, ctx) => {
  if (env.NODE_ENV !== "production") return;
  if (env.EMAIL_TRANSPORT === "console") {
    ctx.addIssue({
      code: "custom",
      path: ["EMAIL_TRANSPORT"],
      message: "console transport is not allowed in production",
    });
  }
  if (!env.BETTER_AUTH_URL.startsWith("https://")) {
    ctx.addIssue({
      code: "custom",
      path: ["BETTER_AUTH_URL"],
      message: "must use https in production",
    });
  }
});

export type Env = z.infer<typeof envSchema>;

export function parseEnv(source: Record<string, string | undefined>): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    throw new Error(`Invalid environment variables:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}

export const env: Env = parseEnv(process.env);
