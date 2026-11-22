import { afterAll, beforeAll } from "vitest";
import { db } from "@/lib/db";
import { resetDatabase } from "./support/database";
import { assertTestDatabaseUrl } from "./support/test-database-url";

assertTestDatabaseUrl(process.env.DATABASE_URL);

beforeAll(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await db.$disconnect();
});
