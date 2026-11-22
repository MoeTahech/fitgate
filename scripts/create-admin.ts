/**
 * Creates the first admin account. Only works while no active admin exists.
 *
 *   npm run auth:create-admin
 *
 * Prompts for name, email, and password (hidden). For non-interactive use, set
 * ADMIN_NAME, ADMIN_EMAIL, and ADMIN_PASSWORD in the environment instead.
 */
import { createInterface } from "node:readline/promises";
import { z } from "zod";
import { fieldErrors, signUpSchema } from "../src/lib/auth/schemas";
import { db } from "../src/lib/db";
import { bootstrapAdmin, BootstrapError } from "../src/lib/services/bootstrap-admin";

async function prompt(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await rl.question(question)).trim();
  } finally {
    rl.close();
  }
}

function promptHidden(question: string): Promise<string> {
  const { stdin, stdout } = process;
  return new Promise((resolve, reject) => {
    stdout.write(question);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    let value = "";

    const finish = (error?: Error) => {
      stdin.off("data", onData);
      stdin.setRawMode(false);
      stdin.pause();
      stdout.write("\n");
      if (error) reject(error);
      else resolve(value);
    };

    function onData(chunk: string) {
      for (const char of chunk) {
        if (char === "\r" || char === "\n") return finish();
        if (char === "\u0003") return finish(new Error("Cancelled"));
        if (char === "\u007f" || char === "\b") value = value.slice(0, -1);
        else if (char >= " ") value += char;
      }
    }

    stdin.on("data", onData);
  });
}

async function readInput(): Promise<z.input<typeof signUpSchema>> {
  const { ADMIN_NAME, ADMIN_EMAIL, ADMIN_PASSWORD } = process.env;
  if (ADMIN_NAME && ADMIN_EMAIL && ADMIN_PASSWORD) {
    return { name: ADMIN_NAME, email: ADMIN_EMAIL, password: ADMIN_PASSWORD };
  }
  if (!process.stdin.isTTY) {
    throw new Error("Run interactively, or set ADMIN_NAME, ADMIN_EMAIL, and ADMIN_PASSWORD.");
  }

  const name = ADMIN_NAME ?? (await prompt("Name: "));
  const email = ADMIN_EMAIL ?? (await prompt("Email: "));
  const password = ADMIN_PASSWORD ?? (await promptHidden("Password (min 10 characters): "));
  if (!ADMIN_PASSWORD && (await promptHidden("Confirm password: ")) !== password) {
    throw new Error("Passwords don't match.");
  }
  return { name, email, password };
}

async function main() {
  const input = await readInput();
  const parsed = signUpSchema.safeParse(input);
  if (!parsed.success) {
    for (const [field, message] of Object.entries(fieldErrors(parsed.error))) console.error(`${field}: ${message}`);
    process.exitCode = 1;
    return;
  }

  try {
    const { email } = await bootstrapAdmin(parsed.data);
    console.info(`Admin account created for ${email}. Sign in at /sign-in.`);
  } catch (error) {
    if (error instanceof BootstrapError) {
      console.error(
        error.code === "ADMIN_EXISTS"
          ? "An admin already exists. Change roles from /admin/users instead."
          : "A user with this email already exists. Use another email, or have an admin promote that account.",
      );
      process.exitCode = 1;
      return;
    }
    throw error;
  }
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
