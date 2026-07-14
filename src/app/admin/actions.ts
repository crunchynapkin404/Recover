"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { mintInvite } from "@/lib/invites";

export interface AdminActionResult {
  ok: boolean;
  message: string;
  code?: string;
}

async function requireOwner() {
  const user = await requireUser();
  if (user.role !== "owner") {
    throw new Error("Owner access required.");
  }
  return user;
}

export async function createInvite(
  _prev: AdminActionResult | null,
  formData: FormData
): Promise<AdminActionResult> {
  const owner = await requireOwner();
  const email = String(formData.get("email") ?? "").trim() || undefined;
  const { code, expiresAt } = await mintInvite(owner.id, email);
  revalidatePath("/admin");
  return {
    ok: true,
    code,
    message: `Invite created — expires ${expiresAt.toISOString().slice(0, 10)}.`,
  };
}

export async function revokeInvite(inviteId: string): Promise<AdminActionResult> {
  await requireOwner();
  await db.delete(schema.invites).where(eq(schema.invites.id, inviteId));
  revalidatePath("/admin");
  return { ok: true, message: "Invite revoked." };
}
