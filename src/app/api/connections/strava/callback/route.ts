import { cookies, headers } from "next/headers";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { encrypt } from "@/lib/crypto";
import { logger } from "@/lib/logger";
import {
  exchangeCode,
  StravaError,
  writeScopeGranted,
} from "@/lib/connectors/strava";

export const dynamic = "force-dynamic";

function settingsRedirect(req: Request, error?: string) {
  const url = new URL("/settings", req.url);
  if (error) url.searchParams.set("strava_error", error);
  return NextResponse.redirect(url);
}

export async function GET(req: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.redirect(new URL("/login", req.url));

  const params = new URL(req.url).searchParams;
  const jar = await cookies();
  const expectedState = jar.get("strava_oauth_state")?.value;
  jar.delete("strava_oauth_state");

  if (params.get("error")) {
    return settingsRedirect(req, "denied");
  }
  const code = params.get("code");
  const state = params.get("state");
  if (!code || !state || !expectedState || state !== expectedState) {
    return settingsRedirect(req, "state_mismatch");
  }
  // Strava reports what the user actually granted (may be less than asked).
  const stravaWriteEnabled = writeScopeGranted(params.get("scope"));

  try {
    const { tokens, athlete } = await exchangeCode(code);
    await db
      .insert(schema.connections)
      .values({
        userId: session.user.id,
        provider: "strava",
        encryptedAccessToken: encrypt(tokens.accessToken),
        encryptedRefreshToken: encrypt(tokens.refreshToken),
        externalAthleteId: athlete.id,
        externalAthleteName: athlete.name,
        expiresAt: new Date(tokens.expiresAt * 1000),
        status: "active",
        stravaWriteEnabled,
      })
      .onConflictDoUpdate({
        target: [schema.connections.userId, schema.connections.provider],
        set: {
          encryptedAccessToken: encrypt(tokens.accessToken),
          encryptedRefreshToken: encrypt(tokens.refreshToken),
          externalAthleteId: athlete.id,
          externalAthleteName: athlete.name,
          expiresAt: new Date(tokens.expiresAt * 1000),
          status: "active",
          stravaWriteEnabled,
          lastError: null,
          lastSyncAt: null, // fresh backfill window
        },
      });

    // First backfill inline (90 days of summaries — a couple of pages).
    const { runStravaSync } = await import("@/lib/sync/strava-sync");
    await runStravaSync(session.user.id).catch((err) => {
      logger.warn("initial strava sync failed; scheduler will retry", {
        error: err instanceof Error ? err.message : String(err),
      });
    });

    return settingsRedirect(req);
  } catch (err) {
    logger.error("strava oauth callback failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return settingsRedirect(
      req,
      err instanceof StravaError && err.code === "auth" ? "rejected" : "failed"
    );
  }
}
