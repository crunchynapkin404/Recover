import { afterAll, describe, expect, it, beforeEach } from "vitest";
import { and, eq } from "drizzle-orm";

const hasDb =
  !!process.env.DATABASE_URL && process.env.DATABASE_DRIVER === "pg";

const USER = "test-backfill-user";

// --- Bug 1: parseWallClockAsUtc must not depend on host TZ -----------------
// Pure unit test, no DB required — always runs regardless of DATABASE_URL,
// unlike the DB-gated suite below. This directly targets the confirmed
// incident: `new Date(str)` on a timezone-less wall-clock string parses as
// the *executing process's* local time, which only "worked" by coincidence
// when run inside the production container (pinned to UTC). This sandbox's
// host TZ is Europe/Amsterdam (UTC+2) — confirmed via
// `Intl.DateTimeFormat().resolvedOptions().timeZone` — which is exactly how
// the prior run silently corrupted data when executed from a non-UTC host.
describe("parseWallClockAsUtc", () => {
  const originalTz = process.env.TZ;
  afterAll(() => {
    if (originalTz === undefined) delete process.env.TZ;
    else process.env.TZ = originalTz;
  });

  it("preserves wall-clock digits as the stored UTC instant, independent of process.env.TZ", async () => {
    const { parseWallClockAsUtc } = await import(
      "../scripts/backfill-start-date-local"
    );

    for (const tz of ["UTC", "Europe/Amsterdam", "Pacific/Kiritimati"]) {
      process.env.TZ = tz;
      // intervals.icu's raw, offset-less start_date_local.
      expect(parseWallClockAsUtc("2026-07-23T10:19:54").toISOString()).toBe(
        "2026-07-23T10:19:54.000Z"
      );
      // Strava's start_date_local after its misleading trailing "Z" has
      // already been stripped by the caller — same offset-less shape.
      expect(parseWallClockAsUtc("2026-07-24T08:31:51").toISOString()).toBe(
        "2026-07-24T08:31:51.000Z"
      );
      // Already-"Z"-suffixed input is left as-is (idempotent).
      expect(parseWallClockAsUtc("2026-07-24T08:31:51Z").toISOString()).toBe(
        "2026-07-24T08:31:51.000Z"
      );
    }
  });
});

describe.skipIf(!hasDb)("backfillStartDateLocal", () => {
  afterAll(async () => {
    const { db, schema } = await import("@/lib/db");
    await db.delete(schema.activities).where(eq(schema.activities.userId, USER));
    await db.delete(schema.users).where(eq(schema.users.id, USER));
  });

  beforeEach(async () => {
    const { db, schema } = await import("@/lib/db");
    await db
      .insert(schema.users)
      .values({ id: USER, name: "Backfill Test", email: "backfill-test@example.invalid" })
      .onConflictDoNothing();
    await db.delete(schema.activities).where(eq(schema.activities.userId, USER));
  });

  it("recomputes startDate/startDateLocal from a row's own raw JSON, dry-run changes nothing", async () => {
    const { db, schema } = await import("@/lib/db");
    const { backfillStartDateLocal } = await import(
      "../scripts/backfill-start-date-local"
    );
    const [row] = await db
      .insert(schema.activities)
      .values({
        userId: USER,
        provider: "intervals_icu",
        externalId: "bf-1",
        // An arbitrary wrong stored instant standing in for the historical
        // corruption — its exact value doesn't matter beyond "differs from
        // the correctly recomputed value below," and it's Z-anchored so the
        // test is deterministic regardless of host TZ.
        startDate: new Date("2026-01-10T08:00:00Z"),
        sport: "Ride",
        raw: {
          id: "bf-1",
          source: "GARMIN_CONNECT",
          start_date: "2026-01-10T06:00:00Z",
          start_date_local: "2026-01-10T08:00:00",
        },
      })
      .returning();

    // Every real (non-dry-run) call below is scoped to this synthetic test
    // user (Bug 2 fix) — never calls the unscoped whole-table path.
    const dryRun = await backfillStartDateLocal({ dryRun: true, userId: USER });
    expect(dryRun.changed).toBe(1);
    const untouched = await db.query.activities.findFirst({
      where: eq(schema.activities.id, row.id),
    });
    expect(untouched?.startDateLocal).toBeNull();
    expect(untouched?.startDate.getTime()).toBe(
      new Date("2026-01-10T08:00:00Z").getTime()
    );

    const real = await backfillStartDateLocal({ dryRun: false, userId: USER });
    expect(real.changed).toBe(1);
    const fixed = await db.query.activities.findFirst({
      where: eq(schema.activities.id, row.id),
    });
    // startDate is always safe to assert via getTime() (true UTC instant).
    expect(fixed?.startDate.getTime()).toBe(
      new Date("2026-01-10T06:00:00Z").getTime()
    );
    // startDateLocal is now anchored to UTC by parseWallClockAsUtc (Bug 1
    // fix) — we're specifically testing the true-UTC storage instant the
    // parse produces here, so getTime() against a Z-suffixed expectation is
    // the correct, TZ-safe assertion per this plan's TZ-safety convention.
    expect(fixed?.startDateLocal?.getTime()).toBe(
      new Date("2026-01-10T08:00:00Z").getTime()
    );

    // Idempotent — a second real run (still scoped to USER) reports zero
    // changes.
    const second = await backfillStartDateLocal({ dryRun: false, userId: USER });
    expect(second.changed).toBe(0);
  });

  it("corrects a Strava-sourced stub row using its sibling strava-provider row", async () => {
    const { db, schema } = await import("@/lib/db");
    const { backfillStartDateLocal } = await import(
      "../scripts/backfill-start-date-local"
    );
    await db.insert(schema.activities).values({
      userId: USER,
      provider: "strava",
      externalId: "bf-2",
      startDate: new Date("2026-07-23T17:57:38Z"),
      sport: "Ride",
    });
    await db.insert(schema.activities).values({
      userId: USER,
      provider: "intervals_icu",
      externalId: "bf-2",
      startDate: new Date("2026-07-23T19:57:38Z"), // mis-scaled last resort
      sport: "Ride",
      raw: {
        id: "bf-2",
        source: "STRAVA",
        start_date_local: "2026-07-23T19:57:38",
        _note: "STRAVA activities are not available via the API",
      },
    });

    await backfillStartDateLocal({ dryRun: false, userId: USER });

    const stub = await db.query.activities.findFirst({
      where: and(
        eq(schema.activities.userId, USER),
        eq(schema.activities.provider, "intervals_icu"),
        eq(schema.activities.externalId, "bf-2")
      ),
    });
    expect(stub?.startDate.getTime()).toBe(
      new Date("2026-07-23T17:57:38Z").getTime()
    );
  });

  it("strips Strava's misleading trailing Z from a native strava row's own start_date_local, anchoring it to the true UTC-preserved wall-clock instant", async () => {
    // Strava's API puts a trailing "Z" on start_date_local even though the
    // digits are the athlete's local wall-clock time, not true UTC (see
    // connectors/strava.ts and docs/specs/2026-07-23-activity-timezone-fix-design.md).
    // The backfill must strip it before parsing, same as the connector —
    // and then (Bug 1 fix) anchor the resulting offset-less string to UTC
    // via parseWallClockAsUtc, so the stored value doesn't depend on the
    // host TZ the backfill script happens to run under.
    const { db, schema } = await import("@/lib/db");
    const { backfillStartDateLocal } = await import(
      "../scripts/backfill-start-date-local"
    );
    const [row] = await db
      .insert(schema.activities)
      .values({
        userId: USER,
        provider: "strava",
        externalId: "bf-3",
        startDate: new Date("2026-07-23T11:57:38Z"),
        sport: "Ride",
        raw: {
          id: 999,
          start_date: "2026-07-23T11:57:38Z",
          // Local wall-clock is 13:57:38; Strava's API appends a misleading "Z".
          start_date_local: "2026-07-23T13:57:38Z",
        },
      })
      .returning();

    await backfillStartDateLocal({ dryRun: false, userId: USER });

    const fixed = await db.query.activities.findFirst({
      where: eq(schema.activities.id, row.id),
    });
    // We're specifically testing the true-UTC storage instant produced by
    // the Bug 1 fix (host-TZ-independence), so toISOString()/getTime() is
    // the correct assertion here, per this plan's TZ-safety convention.
    expect(fixed?.startDateLocal?.toISOString()).toBe(
      "2026-07-23T13:57:38.000Z"
    );
    // startDate is a true UTC instant — always safe via getTime().
    expect(fixed?.startDate.getTime()).toBe(
      new Date("2026-07-23T11:57:38Z").getTime()
    );
  });

  it("scopes to userId: a real (non-dry-run) call with userId never touches another user's rows", async () => {
    const { db, schema } = await import("@/lib/db");
    const { backfillStartDateLocal } = await import(
      "../scripts/backfill-start-date-local"
    );
    const OTHER_USER = "test-backfill-other-user";
    await db
      .insert(schema.users)
      .values({
        id: OTHER_USER,
        name: "Backfill Other",
        email: "backfill-test-other@example.invalid",
      })
      .onConflictDoNothing();
    await db
      .delete(schema.activities)
      .where(eq(schema.activities.userId, OTHER_USER));

    const otherStaleStartDate = new Date("2026-02-01T08:00:00Z");
    const [otherRow] = await db
      .insert(schema.activities)
      .values({
        userId: OTHER_USER,
        provider: "intervals_icu",
        externalId: "bf-other-1",
        startDate: otherStaleStartDate,
        sport: "Ride",
        raw: {
          id: "bf-other-1",
          source: "GARMIN_CONNECT",
          start_date: "2026-02-01T05:00:00Z",
          start_date_local: "2026-02-01T08:00:00",
        },
      })
      .returning();
    await db.insert(schema.activities).values({
      userId: USER,
      provider: "intervals_icu",
      externalId: "bf-4",
      startDate: new Date("2026-02-02T08:00:00Z"),
      sport: "Ride",
      raw: {
        id: "bf-4",
        source: "GARMIN_CONNECT",
        start_date: "2026-02-02T05:00:00Z",
        start_date_local: "2026-02-02T08:00:00",
      },
    });

    try {
      const result = await backfillStartDateLocal({
        dryRun: false,
        userId: USER,
      });
      expect(result.changed).toBe(1);

      // The other user's stale row must be completely untouched.
      const otherAfter = await db.query.activities.findFirst({
        where: eq(schema.activities.id, otherRow.id),
      });
      expect(otherAfter?.startDate.getTime()).toBe(
        otherStaleStartDate.getTime()
      );
      expect(otherAfter?.startDateLocal).toBeNull();
    } finally {
      await db
        .delete(schema.activities)
        .where(eq(schema.activities.userId, OTHER_USER));
      await db.delete(schema.users).where(eq(schema.users.id, OTHER_USER));
    }
  });
});
