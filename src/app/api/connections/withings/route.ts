import { randomBytes } from "node:crypto";
import { cookies, headers } from "next/headers";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { publicBaseUrl } from "@/lib/base-url";
import { buildAuthorizeUrl } from "@/lib/connectors/withings";

export const dynamic = "force-dynamic";

/** Start the Withings OAuth flow (session required; state in httpOnly cookie). */
export async function GET(req: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.redirect(new URL("/login", publicBaseUrl(req)));
  }

  const state = randomBytes(16).toString("hex");
  const redirectUri = new URL(
    "/api/connections/withings/callback",
    publicBaseUrl(req)
  ).toString();

  const jar = await cookies();
  jar.set("withings_oauth_state", state, {
    httpOnly: true,
    sameSite: "lax",
    secure: new URL(req.url).protocol === "https:",
    maxAge: 600,
    path: "/api/connections/withings",
  });

  return NextResponse.redirect(buildAuthorizeUrl(redirectUri, state));
}
