import { describe, expect, it } from "vitest";
import { POST } from "@/app/api/connections/apple-health/ingest/route";

function reqWithBody(body: string, headers: Record<string, string> = {}) {
  return new Request("http://localhost/api/connections/apple-health/ingest", {
    method: "POST",
    headers: { "x-recover-token": "no-such-token", ...headers },
    body,
  });
}

describe("apple ingest hardening", () => {
  it("rejects an oversized body even when content-length lies", async () => {
    // 11 MB body, but claim it's tiny.
    const big = "x".repeat(11 * 1024 * 1024);
    const res = await POST(reqWithBody(big, { "content-length": "10" }));
    expect(res.status).toBe(413);
  });

  it("sets no-referrer and no-store on responses", async () => {
    const res = await POST(reqWithBody("{}"));
    expect(res.headers.get("Referrer-Policy")).toBe("no-referrer");
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });
});
