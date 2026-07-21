"use server";

import { revalidatePath } from "next/cache";
import { db, schema } from "@/lib/db";
import { requireUser } from "@/lib/session";

const MAX_TAGS = 20;
const MAX_TAG_LEN = 48;

/**
 * v0.20 — save the athlete's "usual" behavior-tag set (journalPrefs). This is
 * the *only* write path for that table: it's called exclusively from the
 * journal form's explicit "Remember these as usual" button, never from the
 * main check-in submit, and it never touches mood, day flags, or the
 * energy/soreness/stress sliders — see journal-form.tsx and the v0.7 Score
 * Integrity spec for why those must never be defaulted.
 */
export async function setUsualBehaviorTags(
  tags: string[]
): Promise<{ ok: boolean; message?: string }> {
  const user = await requireUser();

  const clean = Array.from(
    new Set(
      tags
        .filter((t): t is string => typeof t === "string")
        .map((t) => t.trim())
        .filter((t) => t.length > 0 && t.length <= MAX_TAG_LEN)
    )
  ).slice(0, MAX_TAGS);

  await db
    .insert(schema.journalPrefs)
    .values({ userId: user.id, usualBehaviorTags: clean })
    .onConflictDoUpdate({
      target: schema.journalPrefs.userId,
      set: { usualBehaviorTags: clean },
    });

  revalidatePath("/journal");
  return { ok: true };
}
