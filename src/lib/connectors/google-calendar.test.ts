import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchBusyTimes, getValidGoogleAccessToken } from "./google-calendar";

afterEach(() => vi.unstubAllGlobals());

describe("google-calendar connector", () => {
  it("parses busy blocks from the FreeBusy response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            calendars: {
              primary: {
                busy: [
                  {
                    start: "2026-07-15T09:00:00Z",
                    end: "2026-07-15T10:00:00Z",
                  },
                ],
              },
            },
          }),
          { status: 200 }
        )
      )
    );
    const blocks = await fetchBusyTimes({
      accessToken: "t",
      startDate: "2026-07-15",
      endDate: "2026-07-16",
    });
    expect(blocks).toEqual([
      { start: "2026-07-15T09:00:00Z", end: "2026-07-15T10:00:00Z" },
    ]);
  });

  it("returns [] when the primary calendar has no busy array", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ calendars: {} }), { status: 200 })
        )
    );
    expect(
      await fetchBusyTimes({ accessToken: "t", startDate: "a", endDate: "b" })
    ).toEqual([]);
  });

  it("does not hit the network when the access token is still valid", async () => {
    process.env.ENCRYPTION_KEY ??= "0".repeat(64);
    const { encrypt } = await import("@/lib/crypto");
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const token = await getValidGoogleAccessToken({
      id: "c1",
      encryptedAccessToken: encrypt("still-valid"),
      encryptedRefreshToken: encrypt("r"),
      expiresAt: new Date(Date.now() + 3600_000),
      // remaining Connection fields are unused on this path
    } as Parameters<typeof getValidGoogleAccessToken>[0]);

    expect(token).toBe("still-valid");
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
