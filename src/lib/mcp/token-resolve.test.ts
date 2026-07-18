import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock dependencies
vi.mock("@/lib/db", () => ({
  db: {
    query: {
      apiTokens: { findMany: vi.fn() },
    },
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(() => ({
          then: vi.fn((cb: () => void) => {
            cb?.();
            return { catch: vi.fn() };
          }),
        })),
      })),
    })),
  },
  schema: {
    apiTokens: {
      lookupPrefix: "lookup_prefix",
      revokedAt: "revoked_at",
      id: "id",
    },
  },
}));

import {
  resolveToken,
  hashToken,
  hasScope,
  type TokenInfo,
} from "@/lib/mcp/token-auth";
import { db } from "@/lib/db";

describe("resolveToken", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns null for non-existent token", async () => {
    vi.mocked(db.query.apiTokens.findMany).mockResolvedValue([]);
    const result = await resolveToken("non-existent-token");
    expect(result).toBeNull();
  });

  it("resolves a valid token with correct userId and scopes", async () => {
    const plaintext = "my-secret-token-123";
    const hash = hashToken(plaintext);

    vi.mocked(db.query.apiTokens.findMany).mockResolvedValue([
      {
        id: "tok_1",
        userId: "user_abc",
        tokenHash: hash,
        lookupPrefix: hash.slice(0, 8),
        label: "test",
        scopes: "read|write:wellness",
        lastUsedAt: null,
        revokedAt: null,
        createdAt: new Date(),
      },
    ]);

    const result = await resolveToken(plaintext);
    expect(result).not.toBeNull();
    expect(result!.userId).toBe("user_abc");
    expect(result!.tokenId).toBe("tok_1");
    expect(result!.scopes).toEqual(["read", "write:wellness"]);
  });

  it("rejects when hash doesn't match (timing-safe)", async () => {
    const plaintext = "token-a";
    const wrongHash = hashToken("token-b"); // different token's hash

    vi.mocked(db.query.apiTokens.findMany).mockResolvedValue([
      {
        id: "tok_2",
        userId: "user_xyz",
        tokenHash: wrongHash,
        lookupPrefix: wrongHash.slice(0, 8),
        label: "test",
        scopes: "read",
        lastUsedAt: null,
        revokedAt: null,
        createdAt: new Date(),
      },
    ]);

    const result = await resolveToken(plaintext);
    expect(result).toBeNull();
  });

  it("parses write:icu and drops unknown scopes", async () => {
    const plaintext = "icu-token-1";
    const hash = hashToken(plaintext);

    vi.mocked(db.query.apiTokens.findMany).mockResolvedValue([
      {
        id: "tok_3",
        userId: "user_icu",
        tokenHash: hash,
        lookupPrefix: hash.slice(0, 8),
        label: "test",
        scopes: "read|write:icu|write:bogus",
        lastUsedAt: null,
        revokedAt: null,
        createdAt: new Date(),
      },
    ]);

    const result = await resolveToken(plaintext);
    expect(result).not.toBeNull();
    expect(result!.scopes).toEqual(["read", "write:icu"]);
  });
});

describe("hasScope", () => {
  it("returns true when scope is present", () => {
    const info: TokenInfo = {
      userId: "u1",
      tokenId: "t1",
      scopes: ["read", "write:wellness"],
    };
    expect(hasScope(info, "read")).toBe(true);
    expect(hasScope(info, "write:wellness")).toBe(true);
  });

  it("returns false when scope is missing", () => {
    const info: TokenInfo = {
      userId: "u1",
      tokenId: "t1",
      scopes: ["read"],
    };
    expect(hasScope(info, "write:wellness")).toBe(false);
  });

  it("gates write:strava like any other scope", () => {
    const info: TokenInfo = {
      userId: "u1",
      tokenId: "t1",
      scopes: ["read", "write:strava"],
    };
    expect(hasScope(info, "write:strava")).toBe(true);
    expect(hasScope({ ...info, scopes: ["read"] }, "write:strava")).toBe(false);
  });

  it("gates write:icu like any other scope", () => {
    const info: TokenInfo = {
      userId: "u1",
      tokenId: "t1",
      scopes: ["read", "write:icu"],
    };
    expect(hasScope(info, "write:icu")).toBe(true);
    expect(hasScope({ ...info, scopes: ["read"] }, "write:icu")).toBe(false);
  });
});
