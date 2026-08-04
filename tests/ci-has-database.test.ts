/**
 * Guards against the release this test ships with silently regressing.
 *
 * Every DB-backed suite in this repo (see tests/db-driver.test.ts,
 * src/lib/training-plan.test.ts, and 69 others) decides whether to run with:
 *
 *   const hasDb = !!process.env.DATABASE_URL && process.env.DATABASE_DRIVER === "pg";
 *   describe.skipIf(!hasDb)(...)
 *
 * That check is presence-based, not connectivity-based. Today
 * .github/workflows/ci.yml sets DATABASE_URL and DATABASE_DRIVER at
 * *job* level, so every step — including `npm test` — sees them, and an
 * unreachable database fails loudly because `node scripts/migrate.mjs`
 * exits 1 before tests even run. But nothing asserts those variables are
 * actually present in CI. If a future edit re-scopes that `env:` block
 * down to a single step (say, just the migrate step) — which is exactly
 * the state this release fixed — `hasDb` silently becomes false in every
 * other step, all 71 gated files skip instead of running, and `npm test`
 * exits 0. The job goes green. That is indistinguishable from success
 * unless a human reads the log and notices ~400 fewer tests ran.
 *
 * This test is deliberately NOT gated on `hasDb` — gating a check of
 * "does hasDb hold" on `hasDb` itself would make it vacuous, which is the
 * defect being closed. It only runs in CI (CI=true, set by every GitHub
 * Actions runner) so a developer's DB-less laptop keeps skipping like
 * every other gated suite; see tests/db-driver.test.ts for that pattern
 * inverted (skips without a db; this skips *unless* it's CI).
 */
import { describe, expect, it } from "vitest";

const inCI = process.env.CI === "true";

describe.skipIf(!inCI)("CI database presence", () => {
  it("has DATABASE_URL and DATABASE_DRIVER=pg set at job level", () => {
    const hasDb =
      !!process.env.DATABASE_URL && process.env.DATABASE_DRIVER === "pg";

    expect(
      hasDb,
      "CI is running without a database: DATABASE_URL and/or " +
        'DATABASE_DRIVER="pg" are not set. This means every ' +
        "describe.skipIf(!hasDb) suite (71 files, ~405 tests) is silently " +
        "skipping instead of running, and the job will still go green. " +
        "Check the job-level `env:` block in .github/workflows/ci.yml — " +
        "it must set DATABASE_URL and DATABASE_DRIVER for the whole job, " +
        "not just an individual step like the migrate step."
    ).toBe(true);
  });
});
