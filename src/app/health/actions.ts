"use server";

// Retired route (Option B IA): the page moved to /body?tab=labs and
// next.config.ts redirects the old URL. These server actions stay put —
// the forms that call them are mounted by Body now.

import { revalidatePath } from "next/cache";
import { db, schema } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { extractBiomarkers } from "@/lib/health-extract";
import type {
  ExtractedBiomarker,
  BiomarkerCategory,
} from "@/lib/health-records";
import { normalizeBiomarker } from "@/lib/health-records";

export interface ExtractResult {
  ok: boolean;
  message?: string;
  biomarkers: ExtractedBiomarker[];
  method?: "llm" | "text-parser";
}

const MAX_FILE_BYTES = 15 * 1024 * 1024;

/** Extract candidate biomarkers from pasted text or an uploaded file. Stores nothing. */
export async function extractAction(
  _prev: ExtractResult | null,
  formData: FormData
): Promise<ExtractResult> {
  const user = await requireUser();
  const text = String(formData.get("text") ?? "").trim();
  const file = formData.get("file");

  let filePart: { data: Uint8Array; mediaType: string } | undefined;
  if (file instanceof File && file.size > 0) {
    if (file.size > MAX_FILE_BYTES) {
      return {
        ok: false,
        message: "File too large (max 15 MB).",
        biomarkers: [],
      };
    }
    filePart = {
      data: new Uint8Array(await file.arrayBuffer()),
      mediaType: file.type || "application/octet-stream",
    };
  }

  if (!text && !filePart) {
    return {
      ok: false,
      message: "Paste lab text or choose a file.",
      biomarkers: [],
    };
  }

  try {
    const result = await extractBiomarkers(user.id, {
      text: text || undefined,
      file: filePart,
    });
    if (result.biomarkers.length === 0) {
      return {
        ok: false,
        message: "No biomarkers found. Try pasting the values as text.",
        biomarkers: [],
      };
    }
    return { ok: true, biomarkers: result.biomarkers, method: result.method };
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : "Extraction failed.",
      biomarkers: [],
    };
  }
}

export interface SaveRow {
  rawLabel: string;
  displayName: string;
  value: number;
  unit: string | null;
  confidence: number | null;
}

/** Persist reviewed biomarker rows for one measurement date. */
export async function saveBiomarkers(
  rows: SaveRow[],
  measuredAt: string
): Promise<{ ok: boolean; message: string; saved: number }> {
  const user = await requireUser();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(measuredAt)) {
    return { ok: false, message: "Pick a valid measurement date.", saved: 0 };
  }
  const clean = rows.filter(
    (r) => r.displayName.trim() && Number.isFinite(r.value)
  );
  if (clean.length === 0) {
    return { ok: false, message: "Nothing to save.", saved: 0 };
  }

  for (const r of clean) {
    const canonical = normalizeBiomarker(r.rawLabel || r.displayName);
    const values = {
      userId: user.id,
      name: canonical.name,
      displayName: r.displayName.trim(),
      category: canonical.category as BiomarkerCategory,
      value: r.value,
      unit: r.unit,
      measuredAt,
      source: "blood_test" as const,
      confidence: r.confidence,
      rawLabel: r.rawLabel || null,
    };
    await db
      .insert(schema.biomarkers)
      .values(values)
      .onConflictDoUpdate({
        target: [
          schema.biomarkers.userId,
          schema.biomarkers.name,
          schema.biomarkers.measuredAt,
        ],
        set: {
          displayName: values.displayName,
          category: values.category,
          value: values.value,
          unit: values.unit,
          source: values.source,
          confidence: values.confidence,
          rawLabel: values.rawLabel,
        },
      });
  }

  revalidatePath("/body");
  return {
    ok: true,
    message: `Saved ${clean.length} biomarkers.`,
    saved: clean.length,
  };
}

/** Manual blood-pressure entry (lands in wellness_daily via the merge). */
export async function saveBloodPressure(
  date: string,
  systolic: number,
  diastolic: number
): Promise<{ ok: boolean; message: string }> {
  const user = await requireUser();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return { ok: false, message: "Pick a valid date." };
  }
  if (
    !Number.isFinite(systolic) ||
    !Number.isFinite(diastolic) ||
    systolic < 60 ||
    systolic > 260 ||
    diastolic < 30 ||
    diastolic > 200
  ) {
    return { ok: false, message: "Enter a plausible reading (e.g. 118 / 76)." };
  }
  // Manual entries win over provider data via the per-field merge — reuse the
  // journal writer path by hitting wellness directly here (BP fields).
  await db
    .insert(schema.wellnessDaily)
    .values({
      userId: user.id,
      date,
      systolic,
      diastolic,
      source: "manual",
      fieldSources: { systolic: "manual", diastolic: "manual" },
    })
    .onConflictDoUpdate({
      target: [schema.wellnessDaily.userId, schema.wellnessDaily.date],
      set: { systolic, diastolic },
    });
  revalidatePath("/body");
  revalidatePath("/");
  return { ok: true, message: "Blood pressure saved." };
}

/** Set the birth year that unlocks the biological-age estimate. */
export async function setBirthYear(
  year: number | null
): Promise<{ ok: boolean; message: string }> {
  const user = await requireUser();
  const nowYear = new Date().getFullYear();
  if (year != null && (year < 1900 || year > nowYear - 10)) {
    return { ok: false, message: "Enter a realistic birth year." };
  }
  await db
    .insert(schema.bodyPrefs)
    .values({ userId: user.id, birthYear: year })
    .onConflictDoUpdate({
      target: schema.bodyPrefs.userId,
      set: { birthYear: year },
    });
  revalidatePath("/body");
  revalidatePath("/");
  return {
    ok: true,
    message: year ? "Birth year saved." : "Birth year cleared.",
  };
}
