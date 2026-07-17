import { describe, expect, it } from "vitest";

/**
 * Regression tests for the proxy matcher (P4R-a). The MCP endpoint and cron
 * route authenticate with bearer credentials, not session cookies — if the
 * matcher catches them, external clients are 307-redirected to /login before
 * the route handler ever runs (this shipped broken in P4).
 *
 * The matcher regex is asserted directly; live-route behavior is covered by
 * the docker smoke run in SELF-HOSTING verification.
 */
import { config } from "@/middleware";

function guarded(path: string): boolean {
  // Next.js matcher patterns are path-to-regexp-style; ours is a single
  // negative-lookahead regex — evaluate it the way Next does (full match
  // against the path without the leading slash captured by `/(...)`).
  const pattern = config.matcher[0];
  const inner = pattern.slice(1); // strip leading "/"
  return new RegExp(`^/${inner}$`).test(path);
}

describe("route guard matcher", () => {
  it.each([
    "/api/mcp",
    "/api/cron",
    "/api/health",
    "/api/auth/sign-in/email",
    "/login",
    "/join/abc123XYZ",
    "/manifest.webmanifest",
    "/sw.js",
    "/icons/icon-192.png",
    "/icons/apple-touch-icon.png",
  ])("excludes bearer/public route %s from the session guard", (path) => {
    expect(guarded(path)).toBe(false);
  });

  it.each([
    "/",
    "/settings",
    "/journal",
    "/coach",
    "/plan",
    "/activity/some-id",
    "/api/chat",
    "/api/push/subscribe",
    "/api/sync/now",
  ])("keeps session-authenticated route %s guarded", (path) => {
    expect(guarded(path)).toBe(true);
  });
});
