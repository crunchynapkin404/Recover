"use server";

import { z } from "zod";
import { redeemInvite } from "@/lib/invites";

export interface JoinResult {
  ok: boolean;
  message: string;
}

const joinSchema = z.object({
  code: z.string().min(6).max(32),
  name: z.string().trim().min(1).max(80),
  email: z.string().trim().email(),
  password: z.string().min(8).max(128),
});

export async function join(
  _prev: JoinResult | null,
  formData: FormData
): Promise<JoinResult> {
  const parsed = joinSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0].message };
  }

  const result = await redeemInvite(parsed.data);
  if (!result.ok) {
    const messages = {
      invalid: "That invite code doesn't exist.",
      expired: "This invite has expired — ask for a new one.",
      used: "This invite was already used.",
      email_taken: "An account with that email already exists.",
    } as const;
    return { ok: false, message: messages[result.reason] };
  }

  return { ok: true, message: "Account created — signing you in…" };
}
