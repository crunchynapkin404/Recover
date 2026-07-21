import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GET } from "@/app/api/metrics/route";

const TEST_TOKEN = "test-metrics-token-2GkQx";

// requires Postgres; skips without DATABASE_URL.
const hasDb =
  !!process.env.DATABASE_URL && process.env.DATABASE_DRIVER === "pg";

describe.skipIf(!hasDb)("/api/metrics", () => {
  let originalToken: string | undefined;

  beforeAll(() => {
    originalToken = process.env.METRICS_TOKEN;
    process.env.METRICS_TOKEN = TEST_TOKEN;
  });

  afterAll(() => {
    if (originalToken === undefined) delete process.env.METRICS_TOKEN;
    else process.env.METRICS_TOKEN = originalToken;
  });

  it("emits prometheus gauges for sync, jobs, and backup freshness", async () => {
    const res = await GET(
      new Request("http://x/api/metrics", {
        headers: { authorization: `Bearer ${TEST_TOKEN}` },
      })
    );
    const body = await res.text();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/plain");
    expect(body).toMatch(/recover_sync_staleness_seconds/);
    expect(body).toMatch(/recover_sync_jobs_failed_total/);
    expect(body).toMatch(/recover_backup_age_seconds/);
    // HELP/TYPE lines precede every metric.
    expect(body).toMatch(/# HELP recover_sync_jobs_failed_total .+/);
    expect(body).toMatch(/# TYPE recover_sync_jobs_failed_total gauge/);
  });

  it("401s when a bearer token is missing or wrong", async () => {
    const noAuth = await GET(new Request("http://x/api/metrics"));
    expect(noAuth.status).toBe(401);

    const badAuth = await GET(
      new Request("http://x/api/metrics", {
        headers: { authorization: "Bearer nope" },
      })
    );
    expect(badAuth.status).toBe(401);
  });

  it("404s when METRICS_TOKEN is not configured", async () => {
    delete process.env.METRICS_TOKEN;
    try {
      const res = await GET(
        new Request("http://x/api/metrics", {
          headers: { authorization: `Bearer ${TEST_TOKEN}` },
        })
      );
      expect(res.status).toBe(404);
    } finally {
      process.env.METRICS_TOKEN = TEST_TOKEN;
    }
  });
});
