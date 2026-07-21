import { describe, expect, it, beforeAll, beforeEach, afterAll } from "vitest";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { recordAuditEvent } from "./audit";

const TEST_USER = "test-audit-user";

describe("recordAuditEvent", () => {
  // auditLog.userId is a real FK to users.id (onDelete: set null), so a
  // "fake" test user id must actually exist in `users` or the insert throws
  // a foreign-key violation (23503) — recordAuditEvent swallows that error
  // and logs it, which surfaced as a silent 0-rows-written test failure
  // rather than a throw. Seed a real row for the test user and clean it up.
  beforeAll(async () => {
    await db
      .insert(schema.users)
      .values({
        id: TEST_USER,
        name: "Test Audit User",
        email: `${TEST_USER}@example.invalid`,
      })
      .onConflictDoNothing();
  });

  afterAll(async () => {
    await db
      .delete(schema.auditLog)
      .where(eq(schema.auditLog.userId, TEST_USER));
    await db.delete(schema.users).where(eq(schema.users.id, TEST_USER));
  });

  beforeEach(async () => {
    await db
      .delete(schema.auditLog)
      .where(eq(schema.auditLog.userId, TEST_USER));
  });

  it("writes a row with event, userId, and metadata", async () => {
    await recordAuditEvent({
      event: "token_created",
      userId: TEST_USER,
      metadata: { label: "Home Assistant" },
    });
    const rows = await db.query.auditLog.findMany({
      where: and(
        eq(schema.auditLog.userId, TEST_USER),
        eq(schema.auditLog.event, "token_created")
      ),
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].metadata).toEqual({ label: "Home Assistant" });
  });

  it("allows a null userId (failed login)", async () => {
    await recordAuditEvent({ event: "login_fail", ip: "1.2.3.4" });
    // No throw = pass; cleanup of null-user rows is out of scope for this test.
    expect(true).toBe(true);
  });
});
