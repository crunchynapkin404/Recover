import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildAuthorizeUrl,
  getStravaDescription,
  StravaError,
  updateStravaActivity,
  writeScopeGranted,
} from "./strava";

process.env.STRAVA_CLIENT_ID ??= "test-client";
process.env.STRAVA_CLIENT_SECRET ??= "test-secret";

afterEach(() => vi.unstubAllGlobals());

describe("writeScopeGranted", () => {
  it("detects activity:write in the callback scope param", () => {
    expect(writeScopeGranted("read,activity:read_all,activity:write")).toBe(
      true
    );
    expect(writeScopeGranted("read,activity:read_all")).toBe(false);
    expect(writeScopeGranted(null)).toBe(false);
    expect(writeScopeGranted("")).toBe(false);
  });
});

describe("buildAuthorizeUrl", () => {
  it("requests read + write scopes", () => {
    const url = new URL(buildAuthorizeUrl("https://app/cb", "state123"));
    expect(url.searchParams.get("scope")).toBe(
      "activity:read_all,activity:write"
    );
  });
});

describe("updateStravaActivity", () => {
  it("PUTs the description to the activity endpoint", async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchSpy);

    await updateStravaActivity({
      accessToken: "tok",
      activityId: "999",
      description: "hello",
    });

    const [url, init] = fetchSpy.mock.calls[0];
    expect(String(url)).toBe("https://www.strava.com/api/v3/activities/999");
    expect(init.method).toBe("PUT");
    expect(init.headers.Authorization).toBe("Bearer tok");
    expect(JSON.parse(init.body)).toEqual({ description: "hello" });
  });

  it.each([
    [401, "auth"],
    [403, "auth"],
    [429, "rate_limited"],
    [500, "network"],
  ])("maps HTTP %i to StravaError %s", async (status, code) => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("{}", { status }))
    );
    await expect(
      updateStravaActivity({
        accessToken: "tok",
        activityId: "999",
        description: "x",
      })
    ).rejects.toMatchObject({ name: "StravaError", code });
  });
});

describe("getStravaDescription", () => {
  it("returns the description field", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ description: "existing text" }), {
          status: 200,
        })
      )
    );
    expect(await getStravaDescription("tok", "999")).toBe("existing text");
  });

  it("returns null for a missing/empty description", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ description: "" }), { status: 200 })
        )
    );
    expect(await getStravaDescription("tok", "999")).toBeNull();
  });

  it("throws StravaError on auth failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("{}", { status: 401 }))
    );
    await expect(getStravaDescription("tok", "999")).rejects.toBeInstanceOf(
      StravaError
    );
  });
});
