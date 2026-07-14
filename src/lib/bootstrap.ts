import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { logger } from "@/lib/logger";

/**
 * First-boot owner seeding for self-hosted deployments: when the users table
 * is empty and OWNER_EMAIL/OWNER_PASSWORD are set, create the owner account.
 * Idempotent — does nothing once any user exists.
 */
export async function ensureOwnerSeeded(): Promise<void> {
  const email = process.env.OWNER_EMAIL;
  const password = process.env.OWNER_PASSWORD;
  if (!email || !password) return;

  const anyUser = await db.query.users.findFirst({ columns: { id: true } });
  if (anyUser) return;

  if (password.length < 8) {
    logger.error("OWNER_PASSWORD must be at least 8 characters; skipping seed");
    return;
  }

  // Public signup is disabled in the main auth config, so seeding uses a
  // script-local instance with signup enabled against the same database.
  const seedAuth = betterAuth({
    database: drizzleAdapter(db, { provider: "pg", usePlural: true, schema }),
    emailAndPassword: { enabled: true },
  });

  const result = await seedAuth.api.signUpEmail({
    body: { email, password, name: process.env.OWNER_NAME ?? "Owner" },
  });

  await db
    .update(schema.users)
    .set({ role: "owner", emailVerified: true })
    .where(eq(schema.users.id, result.user.id));

  logger.info("owner account seeded", { email });
}
