/**
 * Seed the owner account. Idempotent — exits cleanly if the owner exists.
 *
 * Usage:
 *   OWNER_EMAIL=you@example.com OWNER_PASSWORD=... npx tsx scripts/seed-owner.ts
 *
 * Public signup is disabled in the app (invite-only), so this script builds
 * its own Better Auth instance with signup enabled against the same database.
 */
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { eq } from "drizzle-orm";
import { db, schema } from "../src/lib/db";

async function main() {
  const email = process.env.OWNER_EMAIL;
  const password = process.env.OWNER_PASSWORD;
  const name = process.env.OWNER_NAME ?? "Owner";

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
    if (existing.role !== "owner") {
      await db
        .update(schema.users)
        .set({ role: "owner" })
        .where(eq(schema.users.id, existing.id));
      console.log(`Promoted existing user ${email} to owner.`);
    } else {
      console.log(`Owner ${email} already exists — nothing to do.`);
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

  console.log(`Owner account created: ${email}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
