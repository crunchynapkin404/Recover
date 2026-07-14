import { describe, it, expect } from "vitest";
import { checkRateLimit } from "@/lib/mcp/rate-limit";

describe("rate-limit", () => {
  it("allows requests up to the limit", () => {
    const key = "test-token-" + Date.now();
    for (let i = 0; i < 5; i++) {
      const result = checkRateLimit(key, 5, 60_000);
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(4 - i);
    }
  });

  it("rejects requests over the limit", () => {
    const key = "test-limited-" + Date.now();
    // Exhaust the bucket
    for (let i = 0; i < 3; i++) {
      checkRateLimit(key, 3, 60_000);
    }
    const result = checkRateLimit(key, 3, 60_000);
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
  });

  it("different keys have independent limits", () => {
    const key1 = "key1-" + Date.now();
    const key2 = "key2-" + Date.now();

    // Exhaust key1
    for (let i = 0; i < 2; i++) {
      checkRateLimit(key1, 2, 60_000);
    }
    expect(checkRateLimit(key1, 2, 60_000).allowed).toBe(false);

    // key2 should still work
    expect(checkRateLimit(key2, 2, 60_000).allowed).toBe(true);
  });

  it("refills after window expires", async () => {
    const key = "test-refill-" + Date.now();
    // Use a short window
    for (let i = 0; i < 2; i++) {
      checkRateLimit(key, 2, 10); // 10ms window
    }
    // Wait for window to pass
    await new Promise((r) => setTimeout(r, 15));
    const result = checkRateLimit(key, 2, 10);
    expect(result.allowed).toBe(true);
  });
});
