import { describe, expect, it } from "vitest";
import { config, proxy } from "./proxy";

describe("proxy", () => {
  it("exports a proxy function for the auth redirect guard", () => {
    expect(typeof proxy).toBe("function");
  });

  // Pinned verbatim on purpose: this string is the whole auth boundary, and an
  // accidental edit either exposes a session-guarded route or 307s a
  // bearer-authenticated one to /login. Update it deliberately, with a test in
  // tests/route-guard.test.ts for whatever you added.
  //
  // `api/internal` joined the list in v0.104.0. Its absence had been silently
  // breaking the backup sidecar's freshness notification on every nightly run
  // since the endpoint was written — see src/proxy.ts's comment.
  it("keeps bearer-authenticated and public routes out of the auth redirect matcher", () => {
    expect(config.matcher).toEqual([
      "/((?!login|join|api/auth|api/health|api/mcp|api/cron|api/internal|api/webhooks|api/connections/apple-health/ingest|_next|favicon.ico|manifest.webmanifest|sw.js|icons).*)",
    ]);
  });
});
