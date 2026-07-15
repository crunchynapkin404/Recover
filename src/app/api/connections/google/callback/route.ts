import { cookies, headers } from "next/headers";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { encrypt } from "@/lib/crypto";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

function settingsRedirect(req: Request, error?: string) {
  const url = new URL("/settings", req.url);
  if (error) url.searchParams.set("google_error", error);
  return NextResponse.redirect(url);
}

interface GoogleTokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
}

export async function GET(req: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.redirect(new URL("/login", req.url));

  const params = new URL(req.url).searchParams;
  const jar = await cookies();
  const expectedState = jar.get("google_oauth_state")?.value;
  jar.delete("google_oauth_state");

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
      "/api/connections/google/callback",
      req.url
    ).toString();

    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: process.env.GOOGLE_CLIENT_ID!,
        client_secret: process.env.GOOGLE_CLIENT_SECRET!,
        code,
        grant_type: "authorization_code",
        redirect_uri: redirectUri,
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Google token exchange failed (${res.status}): ${text}`);
    }

    const data = (await res.json()) as GoogleTokenResponse;
    if (!data.access_token) {
      throw new Error("Google token response missing access_token");
    }

    const expiresAt = data.expires_in
      ? new Date(Date.now() + data.expires_in * 1000)
      : null;

    await db
      .insert(schema.connections)
      .values({
        userId: session.user.id,
        provider: "google_calendar",
        encryptedAccessToken: encrypt(data.access_token),
        encryptedRefreshToken: data.refresh_token
          ? encrypt(data.refresh_token)
          : null,
        externalAthleteId: "primary",
        externalAthleteName: "Google Calendar",
        expiresAt,
        status: "active",
      })
      .onConflictDoUpdate({
        target: [schema.connections.userId, schema.connections.provider],
        set: {
          encryptedAccessToken: encrypt(data.access_token),
          encryptedRefreshToken: data.refresh_token
            ? encrypt(data.refresh_token)
            : undefined,
          expiresAt,
          status: "active",
          lastError: null,
        },
      });

    return settingsRedirect(req);
  } catch (err) {
    logger.error("google oauth callback failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return settingsRedirect(req, "failed");
  }
}
