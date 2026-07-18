import { cookies, headers } from "next/headers";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { encrypt } from "@/lib/crypto";
import { logger } from "@/lib/logger";
import { publicBaseUrl } from "@/lib/base-url";
import { exchangeCode, WithingsError } from "@/lib/connectors/withings";

export const dynamic = "force-dynamic";

function settingsRedirect(req: Request, error?: string) {
  const url = new URL("/settings", publicBaseUrl(req));
  if (error) url.searchParams.set("withings_error", error);
  return NextResponse.redirect(url);
}

export async function GET(req: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session)
    return NextResponse.redirect(new URL("/login", publicBaseUrl(req)));

  const params = new URL(req.url).searchParams;
  const jar = await cookies();
  const expectedState = jar.get("withings_oauth_state")?.value;
  jar.delete("withings_oauth_state");

  if (params.get("error")) {
    return settingsRedirect(req, "denied");
  }
  const code = params.get("code");
  const state = params.get("state");
  if (!code || !state || !expectedState || state !== expectedState) {
    return settingsRedirect(req, "state_mismatch");
  }

  try {
    const redirectUri = new URL(
      "/api/connections/withings/callback",
      publicBaseUrl(req)
    ).toString();
    const tokens = await exchangeCode(code, redirectUri);

    await db
      .insert(schema.connections)
      .values({
        userId: session.user.id,
        provider: "withings",
        encryptedAccessToken: encrypt(tokens.accessToken),
        encryptedRefreshToken: encrypt(tokens.refreshToken),
        externalAthleteId: tokens.userId,
        externalAthleteName: null,
        expiresAt: new Date(tokens.expiresAt * 1000),
        status: "active",
      })
      .onConflictDoUpdate({
        target: [schema.connections.userId, schema.connections.provider],
        set: {
          encryptedAccessToken: encrypt(tokens.accessToken),
          encryptedRefreshToken: encrypt(tokens.refreshToken),
          externalAthleteId: tokens.userId,
          expiresAt: new Date(tokens.expiresAt * 1000),
          status: "active",
          lastError: null,
          lastSyncAt: null, // fresh backfill window
        },
      });

    const { runWithingsSync } = await import("@/lib/sync/withings-sync");
    await runWithingsSync(session.user.id).catch((err) => {
      logger.warn("initial withings sync failed; scheduler will retry", {
        error: err instanceof Error ? err.message : String(err),
      });
    });

    return settingsRedirect(req);
  } catch (err) {
    logger.error("withings oauth callback failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return settingsRedirect(
      req,
      err instanceof WithingsError && err.code === "auth"
        ? "rejected"
        : "failed"
    );
  }
}
