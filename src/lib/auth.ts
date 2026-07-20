import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { createAuthMiddleware } from "better-auth/api";
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
  // Audit trail (Task 6 of the security-hardening plan): record who signed
  // in and when. login_fail below is best-effort forensic detail, not the
  // brute-force control — rateLimit above is.
  databaseHooks: {
    session: {
      create: {
        after: async (session) => {
          const { recordAuditEvent } = await import("@/lib/audit");
          await recordAuditEvent({
            event: "login_success",
            userId: session.userId,
            ip: session.ipAddress ?? null,
            userAgent: session.userAgent ?? null,
          });
        },
      },
    },
  },
  // Verified against the installed better-auth 1.6.23 (dispatch.mjs): a
  // thrown APIError from the endpoint handler is caught and assigned to
  // `ctx.context.returned` before this after-hook runs, so `instanceof
  // Error` reliably detects a failed /sign-in/email call.
  hooks: {
    after: createAuthMiddleware(async (ctx) => {
      if (
        ctx.path === "/sign-in/email" &&
        ctx.context.returned instanceof Error
      ) {
        const { recordAuditEvent } = await import("@/lib/audit");
        await recordAuditEvent({
          event: "login_fail",
          ip: ctx.request?.headers.get("x-forwarded-for") ?? null,
        });
      }
    }),
  },
  plugins: [nextCookies()],
});

export type Session = typeof auth.$Infer.Session;
