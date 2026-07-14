import { NextRequest, NextResponse } from "next/server";
import { getSessionCookie } from "better-auth/cookies";

// Optimistic redirect only — every page/action still verifies the session
// server-side via requireUser().
export function proxy(request: NextRequest) {
  const sessionCookie = getSessionCookie(request);
  if (!sessionCookie) {
    return NextResponse.redirect(new URL("/login", request.url));
  }
  return NextResponse.next();
}

export const config = {
  // /api/mcp and /api/cron authenticate with bearer tokens/secrets, not
  // session cookies — they must bypass the session redirect or external
  // clients get 307'd to /login before the handler runs.
  matcher: [
    "/((?!login|api/auth|api/health|api/mcp|api/cron|_next|favicon.ico).*)",
  ],
};
