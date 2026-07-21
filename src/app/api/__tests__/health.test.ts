import { describe, expect, it } from "vitest";
import { GET } from "@/app/api/health/route";

// requires Postgres; skips without DATABASE_URL.
const hasDb =
  !!process.env.DATABASE_URL && process.env.DATABASE_DRIVER === "pg";

describe.skipIf(!hasDb)("/api/health", () => {
  it("is unauthenticated and 200s with the original fields plus the v0.20 additions", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    // Original contract, unchanged.
    expect(body.status).toBe("ok");
    expect(body.db).toBe("up");
    expect("lastSyncAgeS" in body).toBe(true);
    // v0.20 additions.
    expect(typeof body.jobsPending).toBe("number");
    expect(typeof body.jobsFailed).toBe("number");
    expect("backupAgeS" in body).toBe(true);
  });
});
