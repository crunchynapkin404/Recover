import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db, schema } from "@/lib/db";

/**
 * Server-side account creation. Public signup is disabled in the main auth
 * config (invite-only app); the owner seed (lib/bootstrap.ts) and invite
 * redemption both create accounts through this internal instance instead.
 */
const signupAuth = betterAuth({
  database: drizzleAdapter(db, { provider: "pg", usePlural: true, schema }),
  emailAndPassword: { enabled: true },
});

export async function createAccount(input: {
  email: string;
  password: string;
  name: string;
}): Promise<{ userId: string }> {
  const result = await signupAuth.api.signUpEmail({ body: input });
  return { userId: result.user.id };
}
