import { describe, expect, it, vi } from "vitest";

const hasDb =
  !!process.env.DATABASE_URL && process.env.DATABASE_DRIVER === "pg";

const activityPolls = vi.fn().mockResolvedValue(0);
const wellnessRefresh = vi.fn().mockResolvedValue(0);

vi.mock("@/lib/sync/activity-poll", () => ({
  runActivityPolls: (...args: unknown[]) => activityPolls(...args),
}));
vi.mock("@/lib/sync/wellness-refresh", () => ({
  runWellnessRefresh: (...args: unknown[]) => wellnessRefresh(...args),
}));

/**
 * The tick's housekeeping passes query connections DB-wide and then hit real
 * provider APIs. This repo's DB-gated tests run against a database holding
 * REAL connection rows, so an unguarded pass turns any test that exercises
 * the tick into live network traffic against intervals.icu — and, when an
 * un-reviewed activity happens to exist, a real LLM ride review written into
 * a real athlete's coaching thread.
 *
 * Observed 2026-08-02: a full-suite run produced an llm_usage row
 * (ride_review, haiku, 3027 in / 233 out) and a Dutch ride review in the
 * owner's debrief thread. Both passes are covered directly by their own
 * tests, which scope the query with `userIds` — only the tick's unscoped
 * call is suppressed here.
 */
describe.skipIf(!hasDb)("scheduler housekeeping guard", () => {
  it("does not run the DB-wide provider passes under vitest", async () => {
    activityPolls.mockClear();
    wellnessRefresh.mockClear();

    const { runSchedulerTick } = await import("@/lib/sync/scheduler");
    await runSchedulerTick(async () => {});

    expect(
      activityPolls,
      "activity poll ran during a test — it will hit intervals.icu for real"
    ).not.toHaveBeenCalled();
    expect(
      wellnessRefresh,
      "wellness refresh ran during a test — it will hit intervals.icu for real"
    ).not.toHaveBeenCalled();
  });
});
