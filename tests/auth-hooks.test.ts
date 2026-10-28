import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";

/**
 * The sign-in audit trail and the sign-in limiter in src/lib/auth.ts, driven
 * through the real Better Auth handler with real requests — no mocks.
 *
 * Both audit hooks carry comments verified against one specific better-auth
 * version: how a thrown APIError reaches `ctx.context.returned` before the
 * after-hook runs, and the shape of the /sign-in/email body. Until this file
 * they were covered by manual verification only (see the note in
 * tests/audit-wiring.test.ts), so a library upgrade that changed either would
 * have silenced the audit trail with every test still green.
 *
 * Each case uses its own client IP: the limiter keys on IP and path, and its
 * in-memory store lives as long as the module.
 *
 * Requires Postgres; skips without.
 */
const hasDb =
  !!process.env.DATABASE_URL && process.env.DATABASE_DRIVER === "pg";

const EMAIL = "test-auth-hooks@example.invalid";
const PASSWORD = "auth-hooks-correct-password";
const ORIGIN = process.env.BETTER_AUTH_URL ?? "http://localhost:3000";

let userId = "";

function signIn(password: string, ip: string) {
  return new Request(`${ORIGIN}/api/auth/sign-in/email`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: ORIGIN,
      "x-forwarded-for": ip,
    },
    body: JSON.stringify({ email: EMAIL, password }),
  });
}

async function auditRows(event: "login_success" | "login_fail", ip: string) {
  const { db, schema } = await import("@/lib/db");
  return db
    .select()
    .from(schema.auditLog)
    .where(and(eq(schema.auditLog.event, event), eq(schema.auditLog.ip, ip)));
}

async function cleanup() {
  const { db, schema } = await import("@/lib/db");
  await db
    .delete(schema.auditLog)
    .where(sql`${schema.auditLog.metadata}->>'email' = ${EMAIL}`);
  const user = await db.query.users.findFirst({
    where: eq(schema.users.email, EMAIL),
    columns: { id: true },
  });
  if (user) {
    await db.delete(schema.auditLog).where(eq(schema.auditLog.userId, user.id));
    await db.delete(schema.users).where(eq(schema.users.id, user.id));
  }
}

describe.skipIf(!hasDb)("sign-in: audit trail and limiter", () => {
  beforeAll(async () => {
    await cleanup();
    // Public signup is off in the real config, so seed the way
    // src/lib/bootstrap.ts does: a local instance with signup enabled.
    const { betterAuth } = await import("better-auth");
    const { drizzleAdapter } = await import("better-auth/adapters/drizzle");
    const { db, schema } = await import("@/lib/db");
    const seedAuth = betterAuth({
      database: drizzleAdapter(db, { provider: "pg", usePlural: true, schema }),
      emailAndPassword: { enabled: true },
    });
    const result = await seedAuth.api.signUpEmail({
      body: { email: EMAIL, password: PASSWORD, name: "AuthHooks" },
    });
    userId = result.user.id;
  });

  afterAll(cleanup);

  it("a wrong password is refused and recorded as login_fail with the attempted email", async () => {
    const { auth } = await import("@/lib/auth");
    const ip = "203.0.113.11";

    const res = await auth.handler(signIn("not-the-password", ip));

    expect(res.status).toBe(401);
    const rows = await auditRows("login_fail", ip);
    expect(rows).toHaveLength(1);
    expect(rows[0].userId).toBeNull();
    expect(rows[0].metadata).toEqual({ email: EMAIL });
  });

  it("the right password signs in and is recorded as login_success for that user, with the client IP", async () => {
    const { auth } = await import("@/lib/auth");
    const ip = "203.0.113.12";

    const res = await auth.handler(signIn(PASSWORD, ip));

    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toContain("session_token");
    const rows = await auditRows("login_success", ip);
    expect(rows).toHaveLength(1);
    expect(rows[0].userId).toBe(userId);
    // Nothing failed, so the after-hook must not have written a login_fail.
    expect(await auditRows("login_fail", ip)).toHaveLength(0);
  });

  it("the fourth attempt from one address within ten seconds is refused before the password is checked", async () => {
    const { auth } = await import("@/lib/auth");
    const ip = "203.0.113.13";

    const statuses: number[] = [];
    for (let i = 0; i < 4; i++) {
      statuses.push(
        (await auth.handler(signIn("not-the-password", ip))).status
      );
    }

    // Better Auth's built-in rule for /sign-in/* (3 per 10 s) is the
    // brute-force control here; the config's 20/60 s applies to other paths.
    expect(statuses).toEqual([401, 401, 401, 429]);
    // The refused fourth attempt never reached the endpoint, so no audit row.
    expect(await auditRows("login_fail", ip)).toHaveLength(3);
  });
});
