import { randomBytes } from "node:crypto";
import { cookies, headers } from "next/headers";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { buildAuthorizeUrl } from "@/lib/connectors/strava";

export const dynamic = "force-dynamic";

/** Start the Strava OAuth flow (session required; state in httpOnly cookie). */
export async function GET(req: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.redirect(new URL("/login", req.url));
  }

  const state = randomBytes(16).toString("hex");
  const redirectUri = new URL("/api/connections/strava/callback", req.url).toString();

  const jar = await cookies();
  jar.set("strava_oauth_state", state, {
    httpOnly: true,
    sameSite: "lax",
    secure: new URL(req.url).protocol === "https:",
    maxAge: 600,
    path: "/api/connections/strava",
  });

  return NextResponse.redirect(buildAuthorizeUrl(redirectUri, state));
}
