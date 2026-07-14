/**
 * MCP token authentication — Bearer tokens with SHA-256 hashing,
 * short lookup prefix for fast DB queries, and scope validation.
 *
 * Flow:
 * 1. Client sends `Authorization: Bearer <plaintext>`
 * 2. We take the first 8 hex chars of SHA-256(plaintext) as lookup prefix
 * 3. Query DB for matching prefix (fast index scan)
 * 4. Compare full SHA-256 hash (timing-safe)
 * 5. Check not revoked, validate scope
 */

import { createHash, timingSafeEqual } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { db, schema } from "@/lib/db";

export type Scope = "read" | "write:wellness";

export interface TokenInfo {
  userId: string;
  tokenId: string;
  scopes: Scope[];
}

/** Hash a plaintext token to SHA-256 hex. */
export function hashToken(plaintext: string): string {
  return createHash("sha256").update(plaintext).digest("hex");
}

/** Extract the lookup prefix (first 8 hex chars) from a hash. */
export function lookupPrefixFromHash(hash: string): string {
  return hash.slice(0, 8);
}

/** Parse scopes string (pipe-separated) into typed array. */
function parseScopes(scopesStr: string): Scope[] {
  return scopesStr.split("|").filter((s): s is Scope =>
    s === "read" || s === "write:wellness"
  );
}

/**
 * Resolve a Bearer token to a TokenInfo. Returns null if invalid/revoked.
 * Uses timing-safe comparison for the full hash after prefix lookup.
 */
export async function resolveToken(plaintext: string): Promise<TokenInfo | null> {
  const hash = hashToken(plaintext);
  const prefix = lookupPrefixFromHash(hash);

  // Fast lookup by prefix, filter to non-revoked
  const candidates = await db.query.apiTokens.findMany({
    where: and(
      eq(schema.apiTokens.lookupPrefix, prefix),
      isNull(schema.apiTokens.revokedAt)
    ),
  });

  // Timing-safe full hash comparison
  const hashBuf = Buffer.from(hash, "hex");
  const match = candidates.find((c) => {
    const candidateBuf = Buffer.from(c.tokenHash, "hex");
    if (candidateBuf.length !== hashBuf.length) return false;
    return timingSafeEqual(hashBuf, candidateBuf);
  });

  if (!match) return null;

  // Update lastUsedAt (fire-and-forget, don't block auth)
  db.update(schema.apiTokens)
    .set({ lastUsedAt: new Date() })
    .where(eq(schema.apiTokens.id, match.id))
    .then(() => {})
    .catch(() => {});

  return {
    userId: match.userId,
    tokenId: match.id,
    scopes: parseScopes(match.scopes),
  };
}

/** Check if a token has the required scope. */
export function hasScope(tokenInfo: TokenInfo, required: Scope): boolean {
  return tokenInfo.scopes.includes(required);
}
