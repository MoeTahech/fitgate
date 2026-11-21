import { execSync } from "node:child_process";
import { assertTestDatabaseUrl } from "./support/test-database-url";

export function setup(): void {
  const url = assertTestDatabaseUrl(process.env.TEST_DATABASE_URL);

  try {
    execSync("npx prisma migrate deploy", {
      env: { ...process.env, DATABASE_URL: url, DIRECT_URL: url },
      stdio: "pipe",
    });
  } catch (error) {
    const output = (error as { stderr?: Buffer; stdout?: Buffer }) ?? {};
    throw new Error(
      `prisma migrate deploy failed for the test database:\n${output.stdout ?? ""}${output.stderr ?? ""}`,
    );
  }
}
