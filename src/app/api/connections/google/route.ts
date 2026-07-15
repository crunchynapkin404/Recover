import { randomBytes } from "node:crypto";
import { cookies, headers } from "next/headers";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { publicBaseUrl } from "@/lib/base-url";

export const dynamic = "force-dynamic";

function env(name: "GOOGLE_CLIENT_ID"): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}

/** Start the Google Calendar OAuth flow (session required; state in httpOnly cookie). */
export async function GET(req: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.redirect(new URL("/login", publicBaseUrl(req)));
  }

  const state = randomBytes(16).toString("hex");
  const redirectUri = new URL(
    "/api/connections/google/callback",
    publicBaseUrl(req)
  ).toString();

  const jar = await cookies();
  jar.set("google_oauth_state", state, {
    httpOnly: true,
    sameSite: "lax",
    secure: new URL(req.url).protocol === "https:",
    maxAge: 600,
    path: "/api/connections/google",
  });

  const params = new URLSearchParams({
    client_id: env("GOOGLE_CLIENT_ID"),
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "https://www.googleapis.com/auth/calendar.readonly",
    state,
    access_type: "offline",
    prompt: "consent",
  });

  return NextResponse.redirect(
    `https://accounts.google.com/o/oauth2/v2/auth?${params}`
  );
}
