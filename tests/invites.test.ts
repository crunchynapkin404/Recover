import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";

// Invite lifecycle integration tests (P5). Requires Postgres; skips without.
const hasDb =
  !!process.env.DATABASE_URL && process.env.DATABASE_DRIVER === "pg";

const OWNER = "test-invite-owner";
const EMAILS = [
  "invitee-1@example.invalid",
  "invitee-2@example.invalid",
  "invitee-3@example.invalid",
];

/**
 * Invites reference users via used_by_user_id (no cascade), so invites must
 * go first. Runs before AND after the suite: a previously failed teardown
 * must never poison the next run.
 */
async function cleanup() {
  const { db, schema } = await import("@/lib/db");
  await db.delete(schema.invites).where(eq(schema.invites.invitedBy, OWNER));
  const created = await db.query.users.findMany({
    where: inArray(schema.users.email, EMAILS),
    columns: { id: true },
  });
  for (const u of created) {
    await db.delete(schema.users).where(eq(schema.users.id, u.id));
  }
  await db.delete(schema.users).where(eq(schema.users.id, OWNER));
}

describe.skipIf(!hasDb)("invite lifecycle", () => {
  beforeAll(async () => {
    await cleanup();
    const { db, schema } = await import("@/lib/db");
    await db
      .insert(schema.users)
      .values({
        id: OWNER,
        name: "Owner",
        email: "invite-owner@example.invalid",
        role: "owner",
      })
      .onConflictDoNothing();
  });

  afterAll(cleanup);

  it("mints and redeems an invite, creating a member account", async () => {
    const { mintInvite, redeemInvite } = await import("@/lib/invites");
    const { db, schema } = await import("@/lib/db");

    const { code } = await mintInvite(OWNER, EMAILS[0]);
    const result = await redeemInvite({
      code,
      email: EMAILS[0],
      password: "test-password-1",
      name: "Invitee One",
    });
    expect(result.ok).toBe(true);

    const user = await db.query.users.findFirst({
      where: eq(schema.users.email, EMAILS[0]),
    });
    expect(user?.role).toBe("member"); // never owner via invite

    const invite = await db.query.invites.findFirst({
      where: eq(schema.invites.code, code),
    });
    expect(invite?.usedByUserId).toBe(user?.id);
  });

  it("rejects reuse of a redeemed invite", async () => {
    const { mintInvite, redeemInvite } = await import("@/lib/invites");
    const { code } = await mintInvite(OWNER);
    const first = await redeemInvite({
      code,
      email: EMAILS[1],
      password: "test-password-2",
      name: "Invitee Two",
    });
    expect(first.ok).toBe(true);

    const second = await redeemInvite({
      code,
      email: EMAILS[2],
      password: "test-password-3",
      name: "Invitee Three",
    });
    expect(second).toEqual({ ok: false, reason: "used" });
  });

  it("rejects expired and unknown codes", async () => {
    const { redeemInvite } = await import("@/lib/invites");
    const { db, schema } = await import("@/lib/db");

    await db.insert(schema.invites).values({
      code: "expired-test-code",
      invitedBy: OWNER,
      expiresAt: new Date(Date.now() - 1000),
    });

    expect(
      await redeemInvite({
        code: "expired-test-code",
        email: EMAILS[2],
        password: "test-password-3",
        name: "X",
      })
    ).toEqual({ ok: false, reason: "expired" });

    expect(
      await redeemInvite({
        code: "no-such-code",
        email: EMAILS[2],
        password: "test-password-3",
        name: "X",
      })
    ).toEqual({ ok: false, reason: "invalid" });
  });

  it("rejects an email that already has an account", async () => {
    const { mintInvite, redeemInvite } = await import("@/lib/invites");
    const { code } = await mintInvite(OWNER);
    expect(
      await redeemInvite({
        code,
        email: EMAILS[0], // created in the first test
        password: "test-password-x",
        name: "Duplicate",
      })
    ).toEqual({ ok: false, reason: "email_taken" });
  });
});
