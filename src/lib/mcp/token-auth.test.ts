import { describe, it, expect } from "vitest";
import { hashToken, lookupPrefixFromHash } from "@/lib/mcp/token-auth";

describe("token-auth", () => {
  it("hashToken produces a 64-char hex SHA-256", () => {
    const hash = hashToken("test-token-123");
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("hashToken is deterministic", () => {
    const a = hashToken("my-secret");
    const b = hashToken("my-secret");
    expect(a).toBe(b);
  });

  it("different tokens produce different hashes", () => {
    const a = hashToken("token-a");
    const b = hashToken("token-b");
    expect(a).not.toBe(b);
  });

  it("lookupPrefixFromHash returns first 8 chars", () => {
    const hash = hashToken("test");
    const prefix = lookupPrefixFromHash(hash);
    expect(prefix).toHaveLength(8);
    expect(hash.startsWith(prefix)).toBe(true);
  });
});
