import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { and, eq } from "drizzle-orm";

/**
 * Task 6 (audit wiring) — verifies createApiToken/revokeApiToken
 * (src/app/settings/token-actions.ts) actually write audit_log rows, by
 * driving the real "use server" actions end-to-end rather than calling
 * recordAuditEvent directly. requireUser and next/cache's revalidatePath
 * are stubbed the same way tests/plan-actions-race.test.ts does — framework
 * plumbing that throws outside a real request context, not the logic under
 * test.
 *
 * The Better Auth session hook (login_success/login_fail) has no server
 * action to drive here and is covered by manual verification instead (see
 * task-6-brief.md Step 6).
 */

const hasDb =
  !!process.env.DATABASE_URL && process.env.DATABASE_DRIVER === "pg";
const USER = "test-audit-wiring-user";

vi.mock("@/lib/session", () => ({
  requireUser: async () => ({ id: USER, name: "AuditWiringUser" }),
}));
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

async function cleanup() {
  const { db, schema } = await import("@/lib/db");
  await db.delete(schema.auditLog).where(eq(schema.auditLog.userId, USER));
  await db.delete(schema.apiTokens).where(eq(schema.apiTokens.userId, USER));
  await db.delete(schema.users).where(eq(schema.users.id, USER));
}

describe.skipIf(!hasDb)("audit wiring: token actions", () => {
  beforeAll(async () => {
    await cleanup();
    const { db, schema } = await import("@/lib/db");
    // House pattern (tests/push.test.ts, tests/week-plans.test.ts): seed a
    // throwaway user on the example.invalid reserved TLD (RFC 2606).
    // auditLog.userId and apiTokens.userId are both real FKs to users.id,
    // so a literal fake id here would 23503 on insert.
    await db
      .insert(schema.users)
      .values({
        id: USER,
        name: "AuditWiringUser",
        email: `${USER}@example.invalid`,
        role: "member",
      })
      .onConflictDoNothing();
  });

  afterAll(cleanup);

  beforeEach(async () => {
    const { db, schema } = await import("@/lib/db");
    await db.delete(schema.auditLog).where(eq(schema.auditLog.userId, USER));
    await db.delete(schema.apiTokens).where(eq(schema.apiTokens.userId, USER));
  });

  it("createApiToken records token_created with label and scopes", async () => {
    const { createApiToken } = await import("@/app/settings/token-actions");
    const { db, schema } = await import("@/lib/db");

    const formData = new FormData();
    formData.set("label", "CI Token");
    formData.set("scopes", "read");
    const result = await createApiToken(null, formData);
    expect(result.ok).toBe(true);

    const rows = await db.query.auditLog.findMany({
      where: and(
        eq(schema.auditLog.userId, USER),
        eq(schema.auditLog.event, "token_created")
      ),
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].metadata).toEqual({ label: "CI Token", scopes: "read" });
  });

  it("revokeApiToken records token_revoked with the label", async () => {
    const { createApiToken, revokeApiToken } =
      await import("@/app/settings/token-actions");
    const { db, schema } = await import("@/lib/db");

    const formData = new FormData();
    formData.set("label", "To Revoke");
    formData.set("scopes", "read");
    await createApiToken(null, formData);

    const token = await db.query.apiTokens.findFirst({
      where: and(
        eq(schema.apiTokens.userId, USER),
        eq(schema.apiTokens.label, "To Revoke")
      ),
    });
    expect(token).toBeDefined();

    const result = await revokeApiToken(token!.id);
    expect(result.ok).toBe(true);

    const rows = await db.query.auditLog.findMany({
      where: and(
        eq(schema.auditLog.userId, USER),
        eq(schema.auditLog.event, "token_revoked")
      ),
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].metadata).toEqual({ label: "To Revoke" });
  });
});
