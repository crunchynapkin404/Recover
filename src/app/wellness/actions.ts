"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db, schema } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { computeDailyMetrics } from "@/lib/metrics";

export interface ActionResult {
  ok: boolean;
  message: string;
}

const optionalNumber = (min: number, max: number) =>
  z.preprocess(
    (v) => (v === "" || v == null ? undefined : Number(v)),
    z.number().min(min).max(max).optional()
  );

const wellnessSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date"),
  sleepHours: optionalNumber(0, 24),
  weightKg: optionalNumber(20, 300),
  energy: optionalNumber(1, 10),
  soreness: optionalNumber(1, 10),
  stress: optionalNumber(1, 10),
  hrvMs: optionalNumber(1, 300),
  restingHr: optionalNumber(20, 120),
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

  // Only the provided fields are written, so a manual entry augments an
  // intervals.icu day instead of wiping it.
  const values: Partial<typeof schema.wellnessDaily.$inferInsert> = {};
  if (input.sleepHours != null)
    values.sleepSecs = Math.round(input.sleepHours * 3600);
  if (input.weightKg != null) values.weightKg = input.weightKg;
  if (input.energy != null) values.energy1_10 = input.energy;
  if (input.soreness != null) values.soreness1_10 = input.soreness;
  if (input.stress != null) values.stress1_10 = input.stress;
  if (input.hrvMs != null) values.hrvMs = input.hrvMs;
  if (input.restingHr != null) values.restingHr = input.restingHr;

  if (Object.keys(values).length === 0) {
    return { ok: false, message: "Fill in at least one field." };
  }

  await db
    .insert(schema.wellnessDaily)
    .values({
      userId: user.id,
      date: input.date,
      source: "manual",
      ...values,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [schema.wellnessDaily.userId, schema.wellnessDaily.date],
      set: { ...values, updatedAt: new Date() },
    });

  await computeDailyMetrics(user.id, input.date);

  revalidatePath("/");
  revalidatePath("/wellness");
  return { ok: true, message: `Saved ${input.date}. Readiness recomputed.` };
}
