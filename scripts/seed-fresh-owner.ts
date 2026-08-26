/**
 * Seed a dataless owner: an account with NO connections and NO wellness rows,
 * ever. Idempotent — exits cleanly if the account already exists and is
 * still empty.
 *
 * Usage:
 *   OWNER_EMAIL=fresh-owner@recover.local OWNER_PASSWORD=... \
 *     npx tsx scripts/seed-fresh-owner.ts
 *
 * Give it an email distinct from the demo owner's (e.g. a `fresh-` prefix,
 * as above) — this account and the demo owner must never be the same row.
 * See this file's "WHY A SEPARATE ACCOUNT" note below.
 *
 * Public signup is disabled in the app (invite-only), so — like
 * scripts/seed-owner.ts, whose account-creation path this copies exactly —
 * this script builds its own Better Auth instance with signup enabled
 * against the same database, rather than hand-inserting a `users` row. A
 * hand-inserted row would need a password hash produced Better Auth's way,
 * which is exactly the kind of thing that looks right and silently isn't.
 *
 * WHY A SEPARATE ACCOUNT, NOT A SEPARATE SCRIPT AGAINST THE DEMO OWNER:
 * Today, Train, Coach and Body each have a first-run branch
 * (isFirstRun(userId), src/lib/first-run.ts) that renders only for an
 * athlete with zero wellness rows and zero active connections, EVER. Every
 * other surface scripts/verify-surfaces.ts captures needs the opposite — an
 * owner with scripts/seed-demo.ts's 90 days of history — and the two states
 * cannot coexist on one account: seeding either one onto an account that
 * already carries the other would either delete real capture fixtures or
 * quietly stop being "dataless". Two accounts, never a shared one; see
 * .github/workflows/surfaces.yml's `capture-first-run` job, which points
 * OWNER_EMAIL at whatever account THIS script created instead of the demo
 * owner, for exactly the four `first-run-*` surfaces.
 *
 * Refuses loudly, rather than silently proceeding past it, if this account
 * already has wellness rows OR an active connection: a polluted fixture
 * would make the four first-run-* surfaces silently capture the wrong page
 * under the right name — no test would catch that, only a person looking at
 * the PNG, and by then it has already shipped. Exactly the failure class
 * task-6-brief.md exists to close (see also src/app/page.tsx's welcome-card
 * comment on the same defect, discovered by a whole-branch review).
 */
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { and, eq } from "drizzle-orm";
import { db, schema } from "../src/lib/db";

async function refuseIfPolluted(userId: string, email: string): Promise<void> {
  const wellness = await db.query.wellnessDaily.findFirst({
    where: eq(schema.wellnessDaily.userId, userId),
    columns: { id: true },
  });
  if (wellness) {
    console.error(
      `Refusing to continue: ${email} already has wellness rows. This ` +
        "account exists so isFirstRun(userId) (src/lib/first-run.ts) reads " +
        "true for the first-run-* surfaces — a polluted fixture would make " +
        "those surfaces silently capture the wrong state under the right " +
        "name. Point OWNER_EMAIL at a genuinely empty account, or delete " +
        "this athlete's wellness_daily rows before rerunning."
    );
    process.exit(1);
  }

  const connection = await db.query.connections.findFirst({
    where: and(
      eq(schema.connections.userId, userId),
      eq(schema.connections.status, "active")
    ),
    columns: { id: true },
  });
  if (connection) {
    console.error(
      `Refusing to continue: ${email} already has an active connection. ` +
        "isFirstRun(userId) treats that the same as wellness data — a " +
        "connected account is not first-run, so capturing the first-run-* " +
        "surfaces against it would silently record the wrong state under " +
        "the right name. Point OWNER_EMAIL at a genuinely empty account, or " +
        "remove/deactivate this athlete's connections before rerunning."
    );
    process.exit(1);
  }
}

async function main() {
  const email = process.env.OWNER_EMAIL;
  const password = process.env.OWNER_PASSWORD;
  const name = process.env.OWNER_NAME ?? "New Athlete";

  if (!email || !password) {
    console.error("OWNER_EMAIL and OWNER_PASSWORD env vars are required.");
    process.exit(1);
  }
  if (password.length < 8) {
    console.error("OWNER_PASSWORD must be at least 8 characters.");
    process.exit(1);
  }

  const existing = await db.query.users.findFirst({
    where: eq(schema.users.email, email),
  });

  if (existing) {
    await refuseIfPolluted(existing.id, email);
    if (existing.role !== "owner") {
      await db
        .update(schema.users)
        .set({ role: "owner" })
        .where(eq(schema.users.id, existing.id));
      console.log(`Promoted existing user ${email} to owner.`);
    } else {
      console.log(
        `Fresh owner ${email} already exists and is still dataless — nothing to do.`
      );
    }
    return;
  }

  const seedAuth = betterAuth({
    database: drizzleAdapter(db, { provider: "pg", usePlural: true, schema }),
    emailAndPassword: { enabled: true },
  });

  const result = await seedAuth.api.signUpEmail({
    body: { email, password, name },
  });

  await db
    .update(schema.users)
    .set({ role: "owner", emailVerified: true })
    .where(eq(schema.users.id, result.user.id));

  console.log(`Fresh (dataless) owner account created: ${email}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
