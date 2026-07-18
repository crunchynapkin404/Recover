"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/session";
import { parseWellnessCSV, parseActivityCSV } from "@/lib/csv-import";
import { upsertWellness } from "@/lib/wellness-write";
import { createManualActivity } from "@/lib/activity-write";
import { computeDailyMetrics } from "@/lib/metrics";

export type ImportResult = {
  ok: boolean;
  message: string;
  imported: number;
  errors: string[];
};

export async function importWellnessCSV(
  _prev: ImportResult | null,
  formData: FormData
): Promise<ImportResult> {
  const user = await requireUser();
  const file = formData.get("file") as File | null;
  if (!file || file.size === 0) {
    return { ok: false, message: "No file selected.", imported: 0, errors: [] };
  }
  if (file.size > 5 * 1024 * 1024) {
    return {
      ok: false,
      message: "File too large (max 5 MB).",
      imported: 0,
      errors: [],
    };
  }

  const text = await file.text();
  const { rows, errors } = parseWellnessCSV(text);

  if (rows.length === 0) {
    return { ok: false, message: "No valid rows found.", imported: 0, errors };
  }

  let imported = 0;
  for (const row of rows) {
    try {
      await upsertWellness(user.id, {
        date: row.date,
        hrvMs: row.hrvMs,
        restingHr: row.restingHr,
        sleepSecs:
          row.sleepHours != null
            ? Math.round(row.sleepHours * 3600)
            : undefined,
        weightKg: row.weightKg,
        energy1_10: row.energy,
        soreness1_10: row.soreness,
        stress1_10: row.stress,
      });
      imported++;
    } catch {
      errors.push(`Failed to import row for ${row.date}`);
    }
  }

  revalidatePath("/");
  revalidatePath("/journal");
  return {
    ok: true,
    message: `Imported ${imported} of ${rows.length} wellness entries.`,
    imported,
    errors,
  };
}

export async function importActivityCSV(
  _prev: ImportResult | null,
  formData: FormData
): Promise<ImportResult> {
  const user = await requireUser();
  const file = formData.get("file") as File | null;
  if (!file || file.size === 0) {
    return { ok: false, message: "No file selected.", imported: 0, errors: [] };
  }
  if (file.size > 5 * 1024 * 1024) {
    return {
      ok: false,
      message: "File too large (max 5 MB).",
      imported: 0,
      errors: [],
    };
  }

  const text = await file.text();
  const { rows, errors } = parseActivityCSV(text);

  if (rows.length === 0) {
    return { ok: false, message: "No valid rows found.", imported: 0, errors };
  }

  let imported = 0;
  let earliestImported: string | null = null;
  for (const row of rows) {
    try {
      await createManualActivity(
        user.id,
        {
          sport: row.sport,
          name: row.name,
          startDate: row.date,
          durationMinutes: row.durationMinutes,
          distanceKm: row.distanceKm,
          load: row.load,
          avgHr: row.avgHr,
          avgPower: row.avgPower,
          elevationM: row.elevationM,
        },
        { recompute: false }
      );
      imported++;
      if (earliestImported == null || row.date < earliestImported)
        earliestImported = row.date;
    } catch {
      errors.push(`Failed to import activity on ${row.date}`);
    }
  }

  // One metrics pass for the whole batch instead of one per row.
  if (earliestImported != null) {
    await computeDailyMetrics(user.id, earliestImported);
  }

  revalidatePath("/");
  revalidatePath("/log");
  return {
    ok: true,
    message: `Imported ${imported} of ${rows.length} activities.`,
    imported,
    errors,
  };
}
