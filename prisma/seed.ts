import { existsSync } from "node:fs";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, type Prisma } from "../src/generated/prisma/client";

if (existsSync(".env")) {
  process.loadEnvFile(".env");
}

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is not set");
}

const db = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

type SeedPlan = Omit<Prisma.PlanCreateInput, "sortOrder" | "currency">;

const openAccessRecurring = {
  type: "BASE",
  openAccess: true,
  billing: "RECURRING",
} as const;

const plans: SeedPlan[] = [
  { ...openAccessRecurring, slug: "basic", name: "Basic", classAccess: "NONE", intervalMonths: 1, priceCents: 3000 },
  { ...openAccessRecurring, slug: "basic-3-months", name: "Basic 3 months", classAccess: "NONE", intervalMonths: 3, priceCents: 8100 },
  { ...openAccessRecurring, slug: "basic-yearly", name: "Basic Yearly", classAccess: "NONE", intervalMonths: 12, priceCents: 28800 },
  { ...openAccessRecurring, slug: "premium", name: "Premium", classAccess: "UNLIMITED", intervalMonths: 1, priceCents: 5000 },
  { ...openAccessRecurring, slug: "premium-3-months", name: "Premium 3 months", classAccess: "UNLIMITED", intervalMonths: 3, priceCents: 13500 },
  { ...openAccessRecurring, slug: "premium-yearly", name: "Premium Yearly", classAccess: "UNLIMITED", intervalMonths: 12, priceCents: 48000 },
  { ...openAccessRecurring, slug: "couples-basic", name: "Couples Basic", classAccess: "NONE", intervalMonths: 1, priceCents: 5000, maxMembers: 2 },
  { ...openAccessRecurring, slug: "couples-premium", name: "Couples Premium", classAccess: "UNLIMITED", intervalMonths: 1, priceCents: 8500, maxMembers: 2 },
  {
    slug: "day-pass",
    name: "Day Pass",
    type: "BASE",
    openAccess: true,
    classAccess: "NONE",
    billing: "ONE_TIME",
    durationMode: "CALENDAR_DAYS",
    durationDays: 1,
    priceCents: 1000,
  },
  {
    slug: "gym-trial",
    name: "Gym Trial",
    type: "BASE",
    openAccess: true,
    classAccess: "NONE",
    billing: "ONE_TIME",
    durationMode: "CALENDAR_DAYS",
    durationDays: 1,
    priceCents: 0,
    trialKind: "GYM",
  },
  {
    slug: "class-trial",
    name: "Class Trial",
    type: "ADDON",
    openAccess: false,
    classAccess: "CREDITS",
    credits: 1,
    billing: "ONE_TIME",
    durationMode: "ROLLING",
    durationDays: 7,
    priceCents: 0,
    trialKind: "CLASS",
  },
  {
    slug: "class-pack",
    name: "Class Pack",
    type: "ADDON",
    openAccess: false,
    classAccess: "CREDITS",
    credits: 10,
    billing: "ONE_TIME",
    durationMode: "ROLLING",
    durationDays: 60,
    priceCents: 7000,
  },
];

const MON_SAT = { opensAtMin: 6 * 60, closesAtMin: 23 * 60 };
const SUNDAY = { opensAtMin: 8 * 60, closesAtMin: 20 * 60 };

async function main(): Promise<void> {
  await db.gymSettings.upsert({
    where: { id: 1 },
    create: { id: 1, name: "FitGate", timeZone: "Asia/Beirut", capacity: 100 },
    update: {},
  });

  for (let weekday = 1; weekday <= 7; weekday++) {
    const hours = weekday === 7 ? SUNDAY : MON_SAT;
    await db.openingHours.upsert({
      where: { weekday },
      create: { weekday, ...hours },
      update: {},
    });
  }

  for (const [index, plan] of plans.entries()) {
    await db.plan.upsert({
      where: { slug: plan.slug },
      create: { ...plan, currency: "usd", sortOrder: (index + 1) * 10 },
      update: {},
    });
  }

  const planCount = await db.plan.count();
  console.log(`Seed complete: ${planCount} plans, gym settings, opening hours.`);
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
