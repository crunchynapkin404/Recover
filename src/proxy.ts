import { NextRequest, NextResponse } from "next/server";
import { getSessionCookie } from "better-auth/cookies";

// Optimistic redirect only — every page/action still verifies the session
// server-side via requireUser().
export function proxy(request: NextRequest) {
  const pathname = new URL(request.url).pathname;
  if (
    pathname.startsWith("/api/webhooks") ||
    pathname.startsWith("/api/connections/apple-health/ingest")
  ) {
    return NextResponse.next();
  }

  const sessionCookie = getSessionCookie(request);
  if (!sessionCookie) {
    return NextResponse.redirect(new URL("/login", request.url));
  }
  return NextResponse.next();
}

export const config = {
  // /api/mcp and /api/cron authenticate with bearer tokens/secrets,
  // /api/webhooks with a provider-issued verify token/signature, and
  // /api/connections/apple-health/ingest with a per-user ingest token
  // (Health Auto Export has no session cookie to send) — they must bypass
  // the session redirect or external clients get 307'd to /login before the
  // handler runs (a POST redirected to the GET-only /login page then 405s).
  // PWA assets (manifest, service worker, icons) are fetched by the browser
  // outside normal navigation and must also stay reachable without a
  // session.
  matcher: [
    "/((?!login|join|api/auth|api/health|api/mcp|api/cron|api/webhooks|api/connections/apple-health/ingest|_next|favicon.ico|manifest.webmanifest|sw.js|icons).*)",
  ],
};
