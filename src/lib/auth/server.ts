import "server-only";
import { prismaAdapter } from "@better-auth/prisma-adapter";
import { betterAuth } from "better-auth";
import { APIError, createAuthMiddleware, getIP } from "better-auth/api";
import { nextCookies } from "better-auth/next-js";
import { after } from "next/server";
import { db } from "@/lib/db";
import { alreadyRegisteredEmail, passwordResetEmail, sendEmail, verificationEmail } from "@/lib/email";
import { env } from "@/lib/env";
import { AUTH_IP_RULES, betterAuthRateLimitStorage, rateLimit, type RateLimitPolicy } from "@/lib/rate-limit";
import {
  AUTH_COOKIE_PREFIX,
  PASSWORD_RESET_TOKEN_TTL_SECONDS,
  ROLES,
  VERIFICATION_TOKEN_TTL_SECONDS,
} from "./constants";

const DAY_SECONDS = 24 * 60 * 60;
const MAX_EMAIL_LENGTH = 254;

function normalizeEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  return email.length > 0 && email.length <= MAX_EMAIL_LENGTH ? email : null;
}

function tooManyRequests(retryAfterSeconds: number): APIError {
  const retryAfter = String(retryAfterSeconds);
  return new APIError(
    "TOO_MANY_REQUESTS",
    { message: "Too many requests. Please try again later." },
    { "Retry-After": retryAfter, "X-Retry-After": retryAfter },
  );
}

/** Per-email limits on top of Better Auth's per-IP limiter (`AUTH_IP_RULES`). */
const PER_EMAIL_LIMITS: Record<string, { policy: RateLimitPolicy; identifier: (ip: string | null, email: string) => string }> = {
  "/sign-in/email": { policy: "signIn", identifier: (ip, email) => `${ip ?? "no-ip"}|${email}` },
  "/request-password-reset": { policy: "passwordResetRequest", identifier: (_ip, email) => email },
};

/** Sign-up related emails share one per-recipient budget so an address can't be flooded. */
async function withinRecipientBudget(email: string): Promise<boolean> {
  return (await rateLimit("verificationEmail", email.toLowerCase())).success;
}

export const auth = betterAuth({
  appName: "FitGate",
  baseURL: env.BETTER_AUTH_URL,
  secret: env.BETTER_AUTH_SECRET,
  database: prismaAdapter(db, { provider: "postgresql", transaction: true }),

  user: {
    additionalFields: {
      role: { type: [...ROLES], input: false, required: false, defaultValue: "MEMBER" },
    },
  },

  emailAndPassword: {
    enabled: true,
    requireEmailVerification: true,
    minPasswordLength: 10,
    maxPasswordLength: 128,
    resetPasswordTokenExpiresIn: PASSWORD_RESET_TOKEN_TTL_SECONDS,
    revokeSessionsOnPasswordReset: true,
    async sendResetPassword({ user, url }) {
      await sendEmail({
        to: user.email,
        ...passwordResetEmail({ name: user.name, url, expiresInMinutes: PASSWORD_RESET_TOKEN_TTL_SECONDS / 60 }),
      });
    },
    async onExistingUserSignUp({ user }) {
      if (!(await withinRecipientBudget(user.email))) return;
      await sendEmail({
        to: user.email,
        ...alreadyRegisteredEmail({ name: user.name, resetUrl: `${env.BETTER_AUTH_URL}/forgot-password` }),
      });
    },
  },

  emailVerification: {
    sendOnSignUp: true,
    sendOnSignIn: true,
    autoSignInAfterVerification: true,
    expiresIn: VERIFICATION_TOKEN_TTL_SECONDS,
    async sendVerificationEmail({ user, url }) {
      if (!(await withinRecipientBudget(user.email))) return;
      await sendEmail({
        to: user.email,
        ...verificationEmail({ name: user.name, url, expiresInMinutes: VERIFICATION_TOKEN_TTL_SECONDS / 60 }),
      });
    },
  },

  verification: {
    storeIdentifier: "hashed",
  },

  session: {
    expiresIn: 7 * DAY_SECONDS,
    updateAge: DAY_SECONDS,
    freshAge: DAY_SECONDS,
    cookieCache: { enabled: false },
  },

  rateLimit: {
    enabled: true,
    customStorage: betterAuthRateLimitStorage,
    customRules: AUTH_IP_RULES,
  },

  hooks: {
    before: createAuthMiddleware(async (ctx) => {
      const limit = PER_EMAIL_LIMITS[ctx.path];
      if (!limit || !ctx.request) return;
      const email = normalizeEmail((ctx.body as { email?: unknown } | undefined)?.email);
      if (!email) return;

      const ip = getIP(ctx.request, ctx.context.options);
      const decision = await rateLimit(limit.policy, limit.identifier(ip, email));
      if (!decision.success) throw tooManyRequests(decision.retryAfterSeconds);
    }),
  },

  advanced: {
    useSecureCookies: env.BETTER_AUTH_URL.startsWith("https://"),
    cookiePrefix: AUTH_COOKIE_PREFIX,
    ipAddress: { ipAddressHeaders: ["x-forwarded-for"] },
    backgroundTasks: {
      handler(promise) {
        try {
          after(promise);
        } catch {
          // Outside a request scope (scripts, tests) the task still runs; Better Auth logs its failure.
        }
      },
    },
  },

  plugins: [nextCookies()],
});

export type Auth = typeof auth;
