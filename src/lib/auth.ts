import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { db, schema } from "@/lib/db";

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: "pg",
    usePlural: true,
    schema,
  }),
  // Extra origins (LAN IP, tunnel hostname) via env — never hardcoded.
  // BETTER_AUTH_URL's origin is trusted implicitly.
  trustedOrigins: (process.env.TRUSTED_ORIGINS ?? "")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean),
  emailAndPassword: {
    enabled: true,
    // Invite-only: the owner is seeded (scripts/seed-owner.ts); friends join
    // via invite codes (Phase 5). Public signup stays off.
    disableSignUp: true,
  },
  user: {
    additionalFields: {
      role: {
        type: "string",
        defaultValue: "member",
        input: false,
      },
    },
  },
  // Brute-force protection. In-memory store is fine for this single-instance
  // deploy (counters reset on restart — acceptable; the tunnel + invite-only
  // model already blunts mass attacks). window in seconds, max requests/window.
  rateLimit: {
    enabled: true,
    window: 60,
    max: 20,
  },
  plugins: [nextCookies()],
});

export type Session = typeof auth.$Infer.Session;
