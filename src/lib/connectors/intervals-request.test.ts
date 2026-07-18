import { afterEach, describe, expect, it, vi } from "vitest";
import { encrypt } from "@/lib/crypto";
import { icuRequest } from "./intervals";

const conn = {
  encryptedAccessToken: encrypt("test-key"),
  externalAthleteId: "i123",
};

function mockFetch(status: number, json: unknown) {
  return vi.fn().mockResolvedValue(
    new Response(JSON.stringify(json), {
      status,
      headers: { "content-type": "application/json" },
    })
  );
}

describe("icuRequest", () => {
  afterEach(() => vi.restoreAllMocks());

  it("substitutes {id}, sets Basic auth, returns parsed JSON", async () => {
    const f = mockFetch(200, { ok: true });
    vi.stubGlobal("fetch", f);
    const out = await icuRequest(conn, "/athlete/{id}/events", {
      query: { oldest: "2026-01-01" },
    });
    expect(out).toEqual({ ok: true });
    const [url, init] = f.mock.calls[0];
    expect(url).toBe(
      "https://intervals.icu/api/v1/athlete/i123/events?oldest=2026-01-01"
    );
    expect((init.headers as Record<string, string>).Authorization).toMatch(
      /^Basic /
    );
  });

  it("sends a JSON body on POST", async () => {
    const f = mockFetch(200, { id: 42 });
    vi.stubGlobal("fetch", f);
    await icuRequest(conn, "/athlete/{id}/events", {
      method: "POST",
      body: { category: "WORKOUT" },
    });
    const [, init] = f.mock.calls[0];
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ category: "WORKOUT" });
  });

  it("returns null for a 204 (DELETE)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(null, { status: 204 }))
    );
    const out = await icuRequest(conn, "/athlete/{id}/events/9", {
      method: "DELETE",
    });
    expect(out).toBeNull();
  });

  it("maps 401 to a ConnectorError", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("nope", { status: 401 }))
    );
    await expect(icuRequest(conn, "/athlete/{id}")).rejects.toThrow(
      /invalid API key/
    );
  });
});
