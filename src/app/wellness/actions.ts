"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/session";
import { upsertWellness } from "@/lib/wellness-write";

export interface ActionResult {
  ok: boolean;
  message: string;
}

const optionalNumber = (min: number, max: number) =>
  z.preprocess(
    (v) => (v === "" || v == null ? undefined : Number(v)),
    z.number().min(min).max(max).optional()
  );

const MOODS = ["happy", "neutral", "exhausted", "injured", "tired"] as const;

const wellnessSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date"),
  sleepHours: optionalNumber(0, 24),
  weightKg: optionalNumber(20, 300),
  energy: optionalNumber(1, 10),
  soreness: optionalNumber(1, 10),
  stress: optionalNumber(1, 10),
  hrvMs: optionalNumber(1, 300),
  restingHr: optionalNumber(20, 120),
  mood: z.preprocess(
    (v) => (v === "" || v == null ? undefined : v),
    z.enum(MOODS).optional()
  ),
  // Tags arrive as a JSON array string from the journal form.
  tags: z.preprocess(
    (v) => {
      if (typeof v !== "string" || v === "") return undefined;
      try {
        const parsed: unknown = JSON.parse(v);
        return Array.isArray(parsed) ? parsed : undefined;
      } catch {
        return undefined;
      }
    },
    z.array(z.string().max(48)).max(20).optional()
  ),
  notes: z.preprocess(
    (v) => (v === "" || v == null ? undefined : v),
    z.string().max(2000).optional()
  ),
});

export async function logWellness(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  const user = await requireUser();

  const parsed = wellnessSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0].message };
  }
  const input = parsed.data;

  const { fieldsWritten } = await upsertWellness(user.id, {
    date: input.date,
    sleepSecs:
      input.sleepHours != null
        ? Math.round(input.sleepHours * 3600)
        : undefined,
    weightKg: input.weightKg,
    energy1_10: input.energy,
    soreness1_10: input.soreness,
    stress1_10: input.stress,
    hrvMs: input.hrvMs,
    restingHr: input.restingHr,
    mood: input.mood,
    tags: input.tags,
    notes: input.notes,
  });

  if (fieldsWritten === 0) {
    return { ok: false, message: "Fill in at least one field." };
  }

  revalidatePath("/");
  revalidatePath("/journal");
  return { ok: true, message: `Saved ${input.date}. Readiness recomputed.` };
}
