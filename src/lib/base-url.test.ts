import { afterEach, describe, expect, it } from "vitest";
import { publicBaseUrl } from "./base-url";

const ORIGINAL = process.env.BETTER_AUTH_URL;

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.BETTER_AUTH_URL;
  else process.env.BETTER_AUTH_URL = ORIGINAL;
});

describe("publicBaseUrl", () => {
  it("prefers BETTER_AUTH_URL over the request origin", () => {
    process.env.BETTER_AUTH_URL = "https://recover.bartabraas.nl";
    const req = new Request("https://1595a877f512:3000/api/x");
    expect(publicBaseUrl(req)).toBe("https://recover.bartabraas.nl");
  });

  it("falls back to the request origin without BETTER_AUTH_URL", () => {
    delete process.env.BETTER_AUTH_URL;
    const req = new Request("http://localhost:3000/api/x?y=1");
    expect(publicBaseUrl(req)).toBe("http://localhost:3000");
  });

  it("builds a correct callback URL", () => {
    process.env.BETTER_AUTH_URL = "https://recover.bartabraas.nl";
    const req = new Request("https://1595a877f512:3000/api/connections/strava");
    expect(
      new URL("/api/connections/strava/callback", publicBaseUrl(req)).toString()
    ).toBe("https://recover.bartabraas.nl/api/connections/strava/callback");
  });
});
