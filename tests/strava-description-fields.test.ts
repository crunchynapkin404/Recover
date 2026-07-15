import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import type { DescriptionFields } from "@/lib/strava-description-fields";

const hasDb =
  !!process.env.DATABASE_URL && process.env.DATABASE_DRIVER === "pg";

const getDesc = vi.fn().mockResolvedValue(null);
const update = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/connectors/strava", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/connectors/strava")>();
  return {
    ...actual,
    getStravaDescription: (...a: unknown[]) => getDesc(...a),
    updateStravaActivity: (...a: unknown[]) => update(...a),
  };
});

// Best efforts would hit intervals.icu; PRs are irrelevant to this guard.
vi.mock("@/lib/athlete-curves", () => ({
  getBestEffortsCached: vi
    .fn()
    .mockResolvedValue({ available: false, data: [] }),
}));

const USER = "test-desc-fields";
const EXTERNAL_ID = "icu-desc-fields-1";

describe.skipIf(!hasDb)("description field selection — write guard", () => {
  beforeAll(async () => {
    const { db, schema } = await import("@/lib/db");
    await db
      .insert(schema.users)
      .values({ id: USER, name: "Fields", email: "df@example.invalid" })
      .onConflictDoNothing();
    // A crashed earlier run can leave a row that trips the
    // (user, provider, external_id) unique index on insert.
    await db
      .delete(schema.activities)
      .where(eq(schema.activities.userId, USER));
    await db.insert(schema.activities).values({
      userId: USER,
      provider: "intervals_icu",
      externalId: EXTERNAL_ID,
      name: "Guard ride",
      sport: "Ride",
      startDate: new Date(),
      raw: { strava_id: 999001, icu_training_load: 85, icu_intensity: 0.87 },
    });
  });

  afterAll(async () => {
    const { db, schema } = await import("@/lib/db");
    await db.delete(schema.users).where(eq(schema.users.id, USER));
  });

  async function describeWith(fields: DescriptionFields) {
    const { db, schema } = await import("@/lib/db");
    await db
      .insert(schema.notificationPrefs)
      .values({ userId: USER, stravaDescriptionFields: fields })
      .onConflictDoUpdate({
        target: schema.notificationPrefs.userId,
        set: { stravaDescriptionFields: fields },
      });
    const activity = await db.query.activities.findFirst({
      where: eq(schema.activities.externalId, EXTERNAL_ID),
    });
    const { describeActivityOnStrava } = await import("@/lib/strava-describer");
    return describeActivityOnStrava({
      userId: USER,
      activity: activity!,
      accessToken: "fake-token",
    });
  }

  it("writes nothing at all when every field is disabled", async () => {
    getDesc.mockClear();
    update.mockClear();

    const outcome = await describeWith({});

    expect(outcome).toEqual({
      wrote: false,
      generated: "",
      reason: "no_fields",
    });
    // No bare marker may ever reach Strava — and we must not even look.
    expect(update).not.toHaveBeenCalled();
    expect(getDesc).not.toHaveBeenCalled();
  });

  it("writes the selected fields only when some are enabled", async () => {
    getDesc.mockClear();
    update.mockClear();

    const outcome = await describeWith({ header: true, load: true });

    expect(outcome.wrote).toBe(true);
    expect(outcome.generated).toContain("🚴 Guard ride");
    expect(outcome.generated).toContain("TL 85");
    expect(outcome.generated).not.toContain("IF 87%"); // intensity not enabled
    expect(update).toHaveBeenCalledTimes(1);
  });

  it("falls back to the full v0.6 template when no config is saved", async () => {
    getDesc.mockClear();
    update.mockClear();

    const outcome = await describeWith(null);

    expect(outcome.wrote).toBe(true);
    expect(outcome.generated).toContain("🚴 Guard ride");
    expect(outcome.generated).toContain("TL 85 | IF 87%");
  });

  it("previews against the user's most recent real activity", async () => {
    const { previewDescription } = await import("@/lib/strava-describer");
    const preview = await previewDescription(USER, {
      header: true,
      load: true,
    });

    expect(preview.sample).toBe(false);
    expect(preview.text).toContain("🚴 Guard ride");
    expect(preview.text).toContain("TL 85");
    // The marker is appended at write time, not part of the generated block.
    expect(preview.text).not.toContain("📊 Recover");
  });

  it("falls back to sample data for a user with no raw activities", async () => {
    const { db, schema } = await import("@/lib/db");
    const EMPTY = "test-desc-fields-empty";
    await db
      .insert(schema.users)
      .values({ id: EMPTY, name: "Empty", email: "dfe@example.invalid" })
      .onConflictDoNothing();

    const { previewDescription } = await import("@/lib/strava-describer");
    const preview = await previewDescription(EMPTY, null);

    expect(preview.sample).toBe(true);
    expect(preview.text).toContain("🚴");
    expect(preview.text.length).toBeGreaterThan(0);

    await db.delete(schema.users).where(eq(schema.users.id, EMPTY));
  });

  it("previews an empty string when every field is disabled", async () => {
    const { previewDescription } = await import("@/lib/strava-describer");
    expect((await previewDescription(USER, {})).text).toBe("");
  });
});
