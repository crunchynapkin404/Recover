import { describe, expect, it } from "vitest";
import nextConfig from "../next.config";

describe("security headers config", () => {
  it("sets clickjacking, nosniff, referrer, HSTS on all routes", async () => {
    const headers = await nextConfig.headers!();
    const all = headers.find((h) => h.source === "/(.*)");
    expect(all).toBeTruthy();
    const byKey = Object.fromEntries(all!.headers.map((h) => [h.key, h.value]));
    expect(byKey["X-Frame-Options"]).toBe("DENY");
    expect(byKey["X-Content-Type-Options"]).toBe("nosniff");
    expect(byKey["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
    expect(byKey["Strict-Transport-Security"]).toContain("max-age=");
    expect(byKey["Content-Security-Policy"]).toContain(
      "frame-ancestors 'none'"
    );
  });
});
