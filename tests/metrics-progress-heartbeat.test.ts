import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { computeDailyMetrics } from "@/lib/metrics";

/**
 * The logger emits one JSON line per event through console.{log,warn,error}
 * (src/lib/logger.ts). Capture the real thing rather than mocking our own
 * logger — the assertion is then about what actually lands in `docker logs`.
 * Mirrors tests/push.test.ts's captureLog helper.
 */
function captureLog(level: "log" | "warn" | "error") {
  const lines: Record<string, unknown>[] = [];
  const spy = vi.spyOn(console, level).mockImplementation((...args) => {
    try {
      lines.push(JSON.parse(String(args[0])));
    } catch {
      // Non-JSON console output from elsewhere; not our concern.
    }
  });
  return {
    restore: () => spy.mockRestore(),
    all: (msg: string) => lines.filter((l) => l.msg === msg),
  };
}

// v0.36 final-review fix 2: computeDailyMetrics ran Phase C of the wellness
// backfill (thousands of sequential upserts, one per date) with no
// heartbeat at all — the single largest unheartbeated span in the job, long
// enough on a slow connection to trip the scheduler's 15-minute
// stale-reclaim and start a second, concurrent backfill for the same user.
// `opts.onProgress` is the fix; these tests prove it actually fires.
//
// Requires Postgres; skips without it.
const hasDb =
  !!process.env.DATABASE_URL && process.env.DATABASE_DRIVER === "pg";

const USER = "test-metrics-progress-heartbeat-user";
// Fixed, far-past window so this never collides with real data or other
// tests' fixtures.
const BASE = new Date(2015, 0, 1); // Thu 2015-01-01, local

function dayN(n: number): string {
  const d = new Date(BASE);
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

async function seedDays(count: number) {
  const rows = Array.from({ length: count }, (_, n) => ({
    userId: USER,
    date: dayN(n),
    hrvMs: 58 + (n % 5),
    restingHr: 49 + (n % 3),
    source: "manual" as const,
  }));
  await db.insert(schema.wellnessDaily).values(rows);
}

async function cleanup() {
  await db
    .delete(schema.dailyMetrics)
    .where(eq(schema.dailyMetrics.userId, USER));
  await db
    .delete(schema.wellnessDaily)
    .where(eq(schema.wellnessDaily.userId, USER));
  await db.delete(schema.users).where(eq(schema.users.id, USER));
}

describe.skipIf(!hasDb)(
  "computeDailyMetrics onProgress heartbeat (v0.36)",
  () => {
    beforeEach(async () => {
      await cleanup();
      await db
        .insert(schema.users)
        .values({
          id: USER,
          name: "Metrics Progress Test",
          email: "metrics-progress-heartbeat@example.invalid",
        })
        .onConflictDoNothing();
    });

    afterAll(cleanup);

    it("fires onProgress once it crosses the 250-date batch boundary", async () => {
      // 260 wellness days -> at least 260 target dates from sinceDate=dayN(0)
      // onward (computeDailyMetrics also always includes real "today", which
      // sorts after this fixed 2015 window as one extra date — harmless here).
      await seedDays(260);
      let beats = 0;

      const computed = await computeDailyMetrics(USER, dayN(0), {
        onProgress: () => {
          beats++;
        },
      });

      expect(computed).toBeGreaterThanOrEqual(260);
      // Fires at the 250th processed date; the run never reaches a second
      // multiple of 250, so exactly one call.
      expect(beats).toBe(1);
    });

    it("never fires when the run stays under the batch size", async () => {
      await seedDays(50);
      let beats = 0;

      await computeDailyMetrics(USER, dayN(0), {
        onProgress: () => {
          beats++;
        },
      });

      expect(beats).toBe(0);
    });

    it("is optional — omitting it changes nothing about the recompute itself", async () => {
      await seedDays(10);
      // No opts at all: every pre-existing call site does this today.
      const computed = await computeDailyMetrics(USER, dayN(0));
      expect(computed).toBeGreaterThanOrEqual(10);
    });

    // Re-review fix: onProgress is caller-supplied and computeDailyMetrics is
    // public, so a throwing callback (e.g. a scheduler heartbeat hitting a
    // transient DB blip) must not abort a recompute that's otherwise
    // succeeding — potentially thousands of dates into a backfill. This is
    // the test that proves the guard, not just documents it: it asserts the
    // recompute both finishes AND actually persisted its rows.
    it("does not abort the recompute when onProgress throws", async () => {
      await seedDays(260);
      const log = captureLog("warn");
      let calls = 0;

      try {
        const computed = await computeDailyMetrics(USER, dayN(0), {
          onProgress: () => {
            calls++;
            throw new Error("boom: heartbeat DB blip");
          },
        });

        // Same crossing as the "fires once" test above — the throw must not
        // have stopped the loop before it finished all 260+ dates.
        expect(computed).toBeGreaterThanOrEqual(260);
        expect(calls).toBe(1);

        const rows = await db.query.dailyMetrics.findMany({
          where: eq(schema.dailyMetrics.userId, USER),
        });
        expect(rows.length).toBeGreaterThanOrEqual(260);

        // Not swallowed silently — degraded monitoring is logged at warn.
        expect(
          log.all("computeDailyMetrics onProgress callback failed")
        ).toHaveLength(1);
      } finally {
        log.restore();
      }
    });
  }
);
