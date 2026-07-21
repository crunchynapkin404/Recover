import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { eq, inArray } from "drizzle-orm";

// requires Postgres; skips without DATABASE_URL (matches the rest of the
// suite — this repo has no separate test DB, so every row here is test-*
// scoped and every query below filters on it).
const hasDb =
  !!process.env.DATABASE_URL && process.env.DATABASE_DRIVER === "pg";

const USER_A = "test-sessions-user-a";
const USER_B = "test-sessions-user-b";

const SESSION_A_CURRENT = "test-sessions-a-current";
const SESSION_A_OTHER = "test-sessions-a-other";
const SESSION_A_EXPIRED = "test-sessions-a-expired";
const SESSION_B = "test-sessions-b-device";

// requireSession() is the only touchpoint the actions use to learn "who is
// calling, and which session made this request" — mocked exactly like
// requireUser() is mocked in app/admin/__tests__/sync-jobs.test.ts, so we
// can drive "acting as user A" vs "acting as user B" without a real signed
// Better Auth cookie.
const { requireSessionMock } = vi.hoisted(() => ({
  requireSessionMock: vi.fn(),
}));
vi.mock("@/lib/session", () => ({
  requireSession: requireSessionMock,
}));

// revalidatePath requires a real Next.js request/static-generation context,
// which a plain vitest unit test has none of — same reasoning as the
// sync-jobs test.
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

// next/headers' headers() also requires a real Next.js request context.
// The value itself is never inspected by these tests — the two mutating
// calls that need it (auth.api.revokeSession / revokeOtherSessions) are
// mocked below — it only needs to not throw.
vi.mock("next/headers", () => ({
  headers: () => Promise.resolve(new Headers()),
}));

// The self-scoping property under test (Step 2 of the task) is our OWN
// ownership pre-check in revokeSession, which runs — and can reject —
// entirely before ever calling Better Auth's real API. The two mutating
// Better Auth endpoints are mocked here so the "happy path" tests can
// assert *what* this app asks Better Auth to do, without needing a real
// signed session cookie (Better Auth signs the session cookie with
// ctx.setSignedCookie, which isn't reasonably reproducible from a unit
// test without duplicating better-call's signing internals).
const { revokeSessionApiMock, revokeOtherSessionsApiMock } = vi.hoisted(() => ({
  revokeSessionApiMock: vi.fn().mockResolvedValue({ status: true }),
  revokeOtherSessionsApiMock: vi.fn().mockResolvedValue({ status: true }),
}));
vi.mock("@/lib/auth", () => ({
  auth: {
    api: {
      revokeSession: revokeSessionApiMock,
      revokeOtherSessions: revokeOtherSessionsApiMock,
    },
  },
}));

describe.skipIf(!hasDb)("session-management actions", () => {
  beforeAll(async () => {
    const { db, schema } = await import("@/lib/db");
    await db
      .insert(schema.users)
      .values([
        {
          id: USER_A,
          name: "Session Test User A",
          email: "session-test-a@example.invalid",
        },
        {
          id: USER_B,
          name: "Session Test User B",
          email: "session-test-b@example.invalid",
        },
      ])
      .onConflictDoNothing();
  });

  afterAll(async () => {
    const { db, schema } = await import("@/lib/db");
    await db
      .delete(schema.sessions)
      .where(inArray(schema.sessions.userId, [USER_A, USER_B]));
    await db
      .delete(schema.auditLog)
      .where(inArray(schema.auditLog.userId, [USER_A, USER_B]));
    await db
      .delete(schema.users)
      .where(inArray(schema.users.id, [USER_A, USER_B]));
  });

  beforeEach(async () => {
    requireSessionMock.mockReset();
    revokeSessionApiMock.mockClear();
    revokeOtherSessionsApiMock.mockClear();

    const { db, schema } = await import("@/lib/db");
    await db
      .delete(schema.sessions)
      .where(inArray(schema.sessions.userId, [USER_A, USER_B]));
    await db
      .delete(schema.auditLog)
      .where(inArray(schema.auditLog.userId, [USER_A, USER_B]));

    const future = new Date(Date.now() + 3600_000);
    const past = new Date(Date.now() - 3600_000);
    await db.insert(schema.sessions).values([
      {
        id: SESSION_A_CURRENT,
        token: `${SESSION_A_CURRENT}-token`,
        userId: USER_A,
        expiresAt: future,
        userAgent: "Mozilla/5.0 (Macintosh) Chrome/120.0 Safari/537.36",
        ipAddress: "10.0.0.1",
      },
      {
        id: SESSION_A_OTHER,
        token: `${SESSION_A_OTHER}-token`,
        userId: USER_A,
        expiresAt: future,
        userAgent: "Mozilla/5.0 (iPhone) Safari/604.1",
        ipAddress: "10.0.0.2",
      },
      {
        id: SESSION_A_EXPIRED,
        token: `${SESSION_A_EXPIRED}-token`,
        userId: USER_A,
        expiresAt: past,
      },
      {
        id: SESSION_B,
        token: `${SESSION_B}-token`,
        userId: USER_B,
        expiresAt: future,
      },
    ]);
  });

  describe("getMySessions (read path — direct DB query, no Better Auth API call)", () => {
    it("returns only the caller's own active sessions, marks the current one, excludes expired rows", async () => {
      const { getMySessions } = await import("@/lib/sessions");

      const { sessions } = await getMySessions(USER_A, SESSION_A_CURRENT);

      const ids = sessions.map((s) => s.id).sort();
      expect(ids).toEqual([SESSION_A_CURRENT, SESSION_A_OTHER].sort());
      expect(ids).not.toContain(SESSION_B); // self-scoped: never another user's row
      expect(ids).not.toContain(SESSION_A_EXPIRED); // expired excluded

      const current = sessions.find((s) => s.id === SESSION_A_CURRENT);
      expect(current?.isCurrent).toBe(true);
      const other = sessions.find((s) => s.id === SESSION_A_OTHER);
      expect(other?.isCurrent).toBe(false);
      // current device pinned first
      expect(sessions[0].id).toBe(SESSION_A_CURRENT);
    });
  });

  describe("revokeSession", () => {
    it("rejects revoking a session that belongs to a DIFFERENT user (self-scoping)", async () => {
      requireSessionMock.mockResolvedValue({
        user: { id: USER_A },
        session: { id: SESSION_A_CURRENT },
      });

      const { revokeSession } = await import("../session-actions");
      const result = await revokeSession(SESSION_B);

      expect(result.ok).toBe(false);
      expect(result.message).toMatch(/not found/i);
      // Never even reached Better Auth — the ownership pre-check rejected
      // it first.
      expect(revokeSessionApiMock).not.toHaveBeenCalled();

      // And, for good measure: user B's session row is untouched.
      const { db, schema } = await import("@/lib/db");
      const untouched = await db.query.sessions.findFirst({
        where: eq(schema.sessions.id, SESSION_B),
      });
      expect(untouched).toBeDefined();
    });

    it("rejects revoking the caller's own CURRENT session (use sign-out-everywhere-else instead)", async () => {
      requireSessionMock.mockResolvedValue({
        user: { id: USER_A },
        session: { id: SESSION_A_CURRENT },
      });

      const { revokeSession } = await import("../session-actions");
      const result = await revokeSession(SESSION_A_CURRENT);

      expect(result.ok).toBe(false);
      expect(result.message).toMatch(/current session/i);
      expect(revokeSessionApiMock).not.toHaveBeenCalled();
    });

    it("revokes the caller's own OTHER (non-current) session via Better Auth's revokeSession API", async () => {
      requireSessionMock.mockResolvedValue({
        user: { id: USER_A },
        session: { id: SESSION_A_CURRENT },
      });

      const { revokeSession } = await import("../session-actions");
      const result = await revokeSession(SESSION_A_OTHER);

      expect(result.ok).toBe(true);
      expect(revokeSessionApiMock).toHaveBeenCalledTimes(1);
      expect(revokeSessionApiMock).toHaveBeenCalledWith(
        expect.objectContaining({
          body: { token: `${SESSION_A_OTHER}-token` },
        })
      );

      const { db, schema } = await import("@/lib/db");
      const auditRows = await db.query.auditLog.findMany({
        where: eq(schema.auditLog.userId, USER_A),
      });
      expect(auditRows.some((r) => r.event === "session_revoked")).toBe(true);
    });
  });

  describe("signOutOtherSessions", () => {
    it("calls Better Auth's revokeOtherSessions, which is scoped to the caller and excludes the current session token", async () => {
      requireSessionMock.mockResolvedValue({
        user: { id: USER_A },
        session: { id: SESSION_A_CURRENT },
      });

      const { signOutOtherSessions } = await import("../session-actions");
      const result = await signOutOtherSessions();

      expect(result.ok).toBe(true);
      expect(revokeOtherSessionsApiMock).toHaveBeenCalledTimes(1);
      // No id/token argument is passed — revokeOtherSessions only accepts
      // { headers }, confirming (together with the source citation in
      // session-actions.ts) that it cannot be pointed at another user's
      // sessions and, per the installed better-auth 1.6.23 source, itself
      // filters out the caller's own current session token before
      // deleting anything — that's what keeps "this device" alive.
      const callArgs = revokeOtherSessionsApiMock.mock.calls[0][0];
      expect(callArgs).not.toHaveProperty("body");

      const { db, schema } = await import("@/lib/db");
      const auditRows = await db.query.auditLog.findMany({
        where: eq(schema.auditLog.userId, USER_A),
      });
      expect(auditRows.some((r) => r.event === "session_revoked_others")).toBe(
        true
      );
    });
  });
});
