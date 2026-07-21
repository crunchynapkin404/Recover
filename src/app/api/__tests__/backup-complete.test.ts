import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { BACKUP_LAST_SUCCESS_KEY } from "@/lib/ops-metrics";
import { POST } from "@/app/api/internal/backup-complete/route";

const TEST_SECRET = "test-backup-notify-secret-9fQm2";

// requires Postgres; skips without DATABASE_URL.
const hasDb =
  !!process.env.DATABASE_URL && process.env.DATABASE_DRIVER === "pg";

function reqWithAuth(auth?: string) {
  return new Request("http://x/api/internal/backup-complete", {
    method: "POST",
    headers: auth ? { authorization: auth } : {},
  });
}

describe.skipIf(!hasDb)("/api/internal/backup-complete", () => {
  let originalSecret: string | undefined;
  let originalRow: { value: string } | undefined;

  beforeAll(async () => {
    originalSecret = process.env.BACKUP_NOTIFY_SECRET;
    process.env.BACKUP_NOTIFY_SECRET = TEST_SECRET;
    originalRow = await db.query.appConfig.findFirst({
      where: eq(schema.appConfig.key, BACKUP_LAST_SUCCESS_KEY),
      columns: { value: true },
    });
  });

  afterAll(async () => {
    if (originalSecret === undefined) delete process.env.BACKUP_NOTIFY_SECRET;
    else process.env.BACKUP_NOTIFY_SECRET = originalSecret;

    if (originalRow) {
      await db
        .update(schema.appConfig)
        .set({ value: originalRow.value })
        .where(eq(schema.appConfig.key, BACKUP_LAST_SUCCESS_KEY));
    } else {
      await db
        .delete(schema.appConfig)
        .where(eq(schema.appConfig.key, BACKUP_LAST_SUCCESS_KEY));
    }
  });

  it("401s when the secret is missing or wrong", async () => {
    const noAuth = await POST(reqWithAuth());
    expect(noAuth.status).toBe(401);

    const badAuth = await POST(reqWithAuth("Bearer nope"));
    expect(badAuth.status).toBe(401);
  });

  it("upserts backup_last_success_at with the current epoch seconds", async () => {
    const before = Math.floor(Date.now() / 1000);
    const res = await POST(reqWithAuth(`Bearer ${TEST_SECRET}`));
    expect(res.status).toBe(200);

    const row = await db.query.appConfig.findFirst({
      where: eq(schema.appConfig.key, BACKUP_LAST_SUCCESS_KEY),
      columns: { value: true },
    });
    expect(row).toBeDefined();
    const stored = Number(row!.value);
    expect(stored).toBeGreaterThanOrEqual(before);
    expect(stored).toBeLessThanOrEqual(before + 5);
  });
});
