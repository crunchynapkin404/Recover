"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/session";
import { createManualActivity } from "@/lib/activity-write";

function optionalNumber(min: number, max: number) {
  return z.preprocess(
    (v) => (v === "" || v == null ? undefined : Number(v)),
    z.number().min(min).max(max).optional()
  );
}

const activitySchema = z.object({
  sport: z.string().min(1, "Sport is required"),
  name: z.preprocess(
    (v) => (v === "" || v == null ? undefined : v),
    z.string().max(200).optional()
  ),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  durationMinutes: optionalNumber(0, 1440),
  distanceKm: optionalNumber(0, 1000),
  load: optionalNumber(0, 999),
  avgHr: optionalNumber(20, 250),
  avgPower: optionalNumber(0, 2000),
  elevationM: optionalNumber(0, 20000),
});

export type ActionResult = { ok: boolean; message: string };

export async function logActivity(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  const user = await requireUser();
  const parsed = activitySchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0].message };
  }
  const input = parsed.data;
  try {
    await createManualActivity(user.id, {
      sport: input.sport,
      name: input.name,
      startDate: input.date,
      durationMinutes: input.durationMinutes,
      distanceKm: input.distanceKm,
      load: input.load,
      avgHr: input.avgHr,
      avgPower: input.avgPower,
      elevationM: input.elevationM,
    });
    revalidatePath("/");
    revalidatePath("/train");
    return { ok: true, message: "Activity logged!" };
  } catch {
    return { ok: false, message: "Failed to save activity." };
  }
}
