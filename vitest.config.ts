import { defineConfig } from "vitest/config";
import { configDefaults } from "vitest/config";
import path from "node:path";

/**
 * Excluded ONLY when the clock is shifted (CLOCK_SHIFT_DAYS), never on a
 * normal run.
 *
 * Every one of these compares a timestamp POSTGRES wrote against a window
 * JavaScript computed — "is this row from today", "has this thread been idle
 * 24h", "is this job due yet", "is this usage row in this month". Shifting
 * only the JS clock puts those two clocks days apart, which no real calendar
 * day ever does, so they fail for the instrument's reason rather than the
 * code's. Running them shifted would report sixteen failures that mean
 * nothing and bury the ones that mean something.
 *
 * The cost is real and worth stating: a fixture inside these eight files that
 * genuinely keys on the calendar is invisible to the sweep. Closing that gap
 * means letting each of these state when its row landed instead of leaving it
 * to the database — the fix v0.139.0 already made to debrief-lifecycle.test.ts
 * — after which the file comes off this list.
 */
const CLOCK_GAP_FILES = [
  "tests/describe-hook.test.ts",
  "tests/ghost-purge.test.ts",
  "tests/llm-usage.test.ts",
  "tests/morning-brief-backstop.test.ts",
  "tests/morning-hook.test.ts",
  "tests/morning-insight.test.ts",
  "tests/scheduler.test.ts",
  "tests/weekly-review.test.ts",
];

const clockShifted = !!process.env.CLOCK_SHIFT_DAYS;

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    // Default node; component tests opt in per-file via
    // `// @vitest-environment jsdom`, so the DB suites keep a fast node env.
    environment: "node",
    // Fails any test that reaches the real network. See the file's header.
    // shift-clock is inert unless CLOCK_SHIFT_DAYS is set; see its header.
    setupFiles: ["./tests/setup/no-network.ts", "./tests/setup/shift-clock.ts"],
    include: ["src/**/*.test.{ts,tsx}", "tests/**/*.test.{ts,tsx}"],
    exclude: [
      ...configDefaults.exclude,
      ...(clockShifted ? CLOCK_GAP_FILES : []),
    ],
    // Integration tests share one Postgres and several (scheduler.test.ts,
    // morning-hook.test.ts) tick the same sync_jobs queue — parallel files
    // would steal each other's jobs.
    fileParallelism: false,
  },
});
