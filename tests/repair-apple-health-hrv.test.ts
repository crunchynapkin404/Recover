import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq, and } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { repairAppleHealthHrv } from "../scripts/repair-apple-health-hrv";

const hasDb =
  !!process.env.DATABASE_URL && process.env.DATABASE_DRIVER === "pg";

const USER = "test-ah-hrv-repair-user";
const OTHER = "test-ah-hrv-bystander-user";

async function ensureUsers() {
  await db
    .insert(schema.users)
    .values([
      { id: USER, name: "AH Repair", email: "ah-repair@example.invalid" },
      {
        id: OTHER,
        name: "AH Bystander",
        email: "ah-bystander@example.invalid",
      },
    ])
    .onConflictDoNothing();
}

async function cleanup() {
  for (const u of [USER, OTHER]) {
    await db
      .delete(schema.wellnessDaily)
      .where(eq(schema.wellnessDaily.userId, u));
    await db
      .delete(schema.dailyMetrics)
      .where(eq(schema.dailyMetrics.userId, u));
  }
}

async function teardown() {
  await cleanup();
  for (const u of [USER, OTHER]) {
    await db.delete(schema.users).where(eq(schema.users.id, u));
  }
}

async function row(userId: string, date: string) {
  return db.query.wellnessDaily.findFirst({
    where: and(
      eq(schema.wellnessDaily.userId, userId),
      eq(schema.wellnessDaily.date, date)
    ),
  });
}

describe.skipIf(!hasDb)("repairAppleHealthHrv", () => {
  beforeEach(async () => {
    await ensureUsers();
    await cleanup();
    // Mirrors the live shape: one row with a free SDNN slot, one already
    // holding a Companion value, one owned by intervals_icu (must not move).
    await db.insert(schema.wellnessDaily).values([
      {
        userId: USER,
        date: "2026-07-25",
        hrvMs: 107.54,
        source: "apple_health",
        fieldSources: { hrvMs: "apple_health" },
      },
      {
        userId: USER,
        date: "2026-07-26",
        hrvMs: 109.14,
        hrvSdnnMs: 106,
        source: "intervals_icu",
        fieldSources: { hrvMs: "apple_health", hrvSdnnMs: "intervals_icu" },
      },
      {
        userId: USER,
        date: "2026-07-27",
        hrvMs: 126,
        source: "intervals_icu",
        fieldSources: { hrvMs: "intervals_icu" },
      },
      {
        userId: OTHER,
        date: "2026-07-25",
        hrvMs: 99,
        source: "apple_health",
        fieldSources: { hrvMs: "apple_health" },
      },
    ]);
  });
  afterAll(teardown);

  it("reports without writing in dry-run", async () => {
    const plan = await repairAppleHealthHrv(USER, { apply: false });
    expect(plan).toEqual([
      { date: "2026-07-25", hrvMs: 107.54, action: "relocate" },
      { date: "2026-07-26", hrvMs: 109.14, action: "clear" },
    ]);
    expect((await row(USER, "2026-07-25"))!.hrvMs).toBe(107.54);
  });

  it("relocates when the SDNN slot is free", async () => {
    await repairAppleHealthHrv(USER, { apply: true });
    const r = await row(USER, "2026-07-25");
    expect(r!.hrvMs).toBeNull();
    expect(r!.hrvSdnnMs).toBe(107.54);
    expect(r!.fieldSources).toMatchObject({ hrvSdnnMs: "apple_health" });
    expect(r!.fieldSources).not.toHaveProperty("hrvMs");
  });

  it("never overwrites a Companion SDNN value already in the slot", async () => {
    await repairAppleHealthHrv(USER, { apply: true });
    const r = await row(USER, "2026-07-26");
    expect(r!.hrvMs).toBeNull();
    expect(r!.hrvSdnnMs).toBe(106);
    expect(r!.fieldSources).toMatchObject({ hrvSdnnMs: "intervals_icu" });
  });

  it("leaves rows this user owns from another source alone", async () => {
    await repairAppleHealthHrv(USER, { apply: true });
    expect((await row(USER, "2026-07-27"))!.hrvMs).toBe(126);
  });

  it("never touches another user's rows", async () => {
    await repairAppleHealthHrv(USER, { apply: true });
    expect((await row(OTHER, "2026-07-25"))!.hrvMs).toBe(99);
  });
});
