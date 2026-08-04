import { describe, expect, it } from "vitest";

// example.com is IANA's reserved example domain — if this ever resolves,
// the guard is gone and this test is the thing that says so.
describe("the no-network guard", () => {
  it("blocks an outbound fetch and names the URL", async () => {
    await expect(fetch("https://example.com/probe")).rejects.toThrow(
      "https://example.com/probe"
    );
  });

  it("names the URL for a URL object too, not just a string", async () => {
    await expect(
      fetch(new URL("https://example.com/from-url-object"))
    ).rejects.toThrow("https://example.com/from-url-object");
  });
});
