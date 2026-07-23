import { describe, expect, it } from "vitest";
import { config, proxy } from "./proxy";

describe("proxy", () => {
  it("exports a proxy function for the auth redirect guard", () => {
    expect(typeof proxy).toBe("function");
  });

  it("keeps /api/webhooks out of the auth redirect matcher", () => {
    expect(config.matcher).toEqual([
      "/((?!login|join|api/auth|api/health|api/mcp|api/cron|api/webhooks|_next|favicon.ico|manifest.webmanifest|sw.js|icons).*)",
    ]);
  });
});
