import { randomBytes } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { logger } from "@/lib/logger";
import { createAccount } from "@/lib/signup";

const INVITE_TTL_DAYS = 14;

export type RedeemResult =
  | { ok: true; userId: string }
  | { ok: false; reason: "invalid" | "expired" | "used" | "email_taken" };

export function generateInviteCode(): string {
  // URL-safe, unambiguous, 12 chars.
  return randomBytes(9).toString("base64url");
}

export async function mintInvite(
  invitedBy: string,
  email?: string
): Promise<{ code: string; expiresAt: Date }> {
  const code = generateInviteCode();
  const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 86_400_000);
  await db.insert(schema.invites).values({
    code,
    email: email || null,
    invitedBy,
    expiresAt,
  });
  return { code, expiresAt };
}

export async function findValidInvite(code: string) {
  const invite = await db.query.invites.findFirst({
    where: eq(schema.invites.code, code),
  });
  if (!invite) return { invite: null, reason: "invalid" as const };
  if (invite.usedByUserId) return { invite: null, reason: "used" as const };
  if (invite.expiresAt < new Date())
    return { invite: null, reason: "expired" as const };
  return { invite, reason: null };
}

/**
 * Redeem an invite: validates the code, creates the account, and marks the
 * invite used — atomically enough for a 10-friend app (the unique claim via
 * `usedByUserId IS NULL` guard prevents double-redemption races).
 */
export async function redeemInvite(input: {
  code: string;
  email: string;
  password: string;
  name: string;
}): Promise<RedeemResult> {
  const { invite, reason } = await findValidInvite(input.code);
  if (!invite) return { ok: false, reason: reason! };

  const existing = await db.query.users.findFirst({
    where: eq(schema.users.email, input.email),
    columns: { id: true },
  });
  if (existing) return { ok: false, reason: "email_taken" };

  const { userId } = await createAccount(input);

  const claimed = await db
    .update(schema.invites)
    .set({ usedByUserId: userId })
    .where(
      and(eq(schema.invites.id, invite.id), isNull(schema.invites.usedByUserId))
    )
    .returning();

  if (claimed.length === 0) {
    // Lost a redemption race — remove the just-created account.
    await db.delete(schema.users).where(eq(schema.users.id, userId));
    return { ok: false, reason: "used" };
  }

  logger.info("invite redeemed", { code: input.code, userId });
  return { ok: true, userId };
}
