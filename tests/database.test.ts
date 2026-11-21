import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { resetDatabase } from "./support/database";

describe("test database", () => {
  it("connects to the migrated test database", async () => {
    const [row] = await db.$queryRaw<{ name: string; migrations: number }[]>`
      SELECT current_database() AS name,
             (SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL)::int AS migrations
    `;
    expect(row.name.endsWith("_test")).toBe(true);
    expect(row.migrations).toBeGreaterThan(0);
  });

  it("truncates application tables but keeps migration history", async () => {
    await db.gymSettings.create({
      data: { name: "Test Gym", timeZone: "Asia/Beirut", capacity: 50 },
    });
    await db.openingHours.create({ data: { weekday: 1, opensAtMin: 360, closesAtMin: 1320 } });
    expect(await db.gymSettings.count()).toBe(1);

    await resetDatabase();

    expect(await db.gymSettings.count()).toBe(0);
    expect(await db.openingHours.count()).toBe(0);
    const [row] = await db.$queryRaw<{ migrations: number }[]>`
      SELECT count(*)::int AS migrations FROM _prisma_migrations
    `;
    expect(row.migrations).toBeGreaterThan(0);
  });
});
