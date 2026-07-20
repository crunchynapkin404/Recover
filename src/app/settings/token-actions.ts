"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { eq, and, isNull } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { hashToken, lookupPrefixFromHash } from "@/lib/mcp/token-auth";
import { recordAuditEvent } from "@/lib/audit";

export interface TokenActionResult {
  ok: boolean;
  message: string;
  /** Only set on creation — plaintext shown once */
  token?: string;
}

export async function createApiToken(
  _prev: TokenActionResult | null,
  formData: FormData
): Promise<TokenActionResult> {
  const user = await requireUser();

  const label = String(formData.get("label") ?? "").trim();
  if (!label) {
    return { ok: false, message: "Label is required." };
  }

  const scopesRaw = String(formData.get("scopes") ?? "read").trim();
  // Keep in sync with the Scope type in lib/mcp/token-auth.ts and the tools'
  // declared scopes — every write-capable tool must be authorizable.
  const validScopes = [
    "read",
    "write:wellness",
    "write:strava",
    "write:plan",
    "write:memory",
    "write:icu",
  ];
  const scopes = scopesRaw.split("|").filter((s) => validScopes.includes(s));
  if (scopes.length === 0) {
    return { ok: false, message: "At least one scope is required." };
  }

  // Generate a 32-byte random token (64 hex chars)
  const plaintext = randomBytes(32).toString("hex");
  const hash = hashToken(plaintext);
  const prefix = lookupPrefixFromHash(hash);

  await db.insert(schema.apiTokens).values({
    userId: user.id,
    tokenHash: hash,
    lookupPrefix: prefix,
    label,
    scopes: scopes.join("|"),
  });

  await recordAuditEvent({
    event: "token_created",
    userId: user.id,
    metadata: { label, scopes: scopes.join("|") },
  });

  revalidatePath("/settings");
  return {
    ok: true,
    message: "Token created. Copy it now — it won't be shown again.",
    token: plaintext,
  };
}

export async function revokeApiToken(
  tokenId: string
): Promise<TokenActionResult> {
  const user = await requireUser();

  // Verify ownership
  const token = await db.query.apiTokens.findFirst({
    where: and(
      eq(schema.apiTokens.id, tokenId),
      eq(schema.apiTokens.userId, user.id),
      isNull(schema.apiTokens.revokedAt)
    ),
  });

  if (!token) {
    return { ok: false, message: "Token not found." };
  }

  await db
    .update(schema.apiTokens)
    .set({ revokedAt: new Date() })
    .where(eq(schema.apiTokens.id, tokenId));

  await recordAuditEvent({
    event: "token_revoked",
    userId: user.id,
    metadata: { label: token.label },
  });

  revalidatePath("/settings");
  return { ok: true, message: "Token revoked." };
}
