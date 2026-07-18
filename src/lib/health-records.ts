/**
 * Health records extraction helpers (v0.13) — pure normalization and
 * validation. The LLM call and DB writes live in the server action; this
 * module is the tested boundary that turns messy input into typed rows and
 * never lets an un-sane value through.
 */

export type BiomarkerCategory =
  | "lipids"
  | "metabolic"
  | "hematology"
  | "hormones"
  | "vitamins"
  | "organ"
  | "other";

interface CanonicalBiomarker {
  name: string;
  displayName: string;
  category: BiomarkerCategory;
}

// Curated synonym map. Keys are lowercased, punctuation-stripped labels;
// this is intentionally small and honest — anything unknown falls back to a
// slug in the "other" category rather than being force-fit.
const SYNONYMS: Record<string, CanonicalBiomarker> = {};
function register(canonical: CanonicalBiomarker, synonyms: string[]): void {
  for (const s of [canonical.displayName, ...synonyms]) {
    SYNONYMS[normalizeKey(s)] = canonical;
  }
}

function normalizeKey(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

register(
  {
    name: "total_cholesterol",
    displayName: "Total Cholesterol",
    category: "lipids",
  },
  ["cholesterol total", "chol", "tc"]
);
register(
  {
    name: "ldl_cholesterol",
    displayName: "LDL Cholesterol",
    category: "lipids",
  },
  ["ldl", "ldl c", "ldl cholesterol calc", "low density lipoprotein"]
);
register(
  {
    name: "hdl_cholesterol",
    displayName: "HDL Cholesterol",
    category: "lipids",
  },
  ["hdl", "hdl c", "high density lipoprotein"]
);
register(
  { name: "triglycerides", displayName: "Triglycerides", category: "lipids" },
  ["trig", "tg"]
);
register(
  { name: "glucose", displayName: "Fasting Glucose", category: "metabolic" },
  ["fasting glucose", "blood glucose", "glucose fasting"]
);
register({ name: "hba1c", displayName: "HbA1c", category: "metabolic" }, [
  "a1c",
  "hemoglobin a1c",
  "glycated hemoglobin",
]);
register({ name: "insulin", displayName: "Insulin", category: "metabolic" }, [
  "fasting insulin",
]);
register(
  { name: "hemoglobin", displayName: "Hemoglobin", category: "hematology" },
  ["hgb", "hb"]
);
register(
  { name: "hematocrit", displayName: "Hematocrit", category: "hematology" },
  ["hct"]
);
register(
  { name: "ferritin", displayName: "Ferritin", category: "hematology" },
  []
);
register({ name: "tsh", displayName: "TSH", category: "hormones" }, [
  "thyroid stimulating hormone",
]);
register(
  { name: "testosterone", displayName: "Testosterone", category: "hormones" },
  ["total testosterone"]
);
register(
  { name: "cortisol", displayName: "Cortisol", category: "hormones" },
  []
);
register(
  { name: "vitamin_d", displayName: "Vitamin D", category: "vitamins" },
  ["25 oh vitamin d", "25 hydroxyvitamin d", "vit d", "vitamin d 25 oh"]
);
register(
  { name: "vitamin_b12", displayName: "Vitamin B12", category: "vitamins" },
  ["b12", "cobalamin"]
);
register(
  { name: "creatinine", displayName: "Creatinine", category: "organ" },
  []
);
register({ name: "alt", displayName: "ALT", category: "organ" }, [
  "alanine aminotransferase",
  "sgpt",
]);
register({ name: "ast", displayName: "AST", category: "organ" }, [
  "aspartate aminotransferase",
  "sgot",
]);
register(
  { name: "crp", displayName: "C-Reactive Protein", category: "organ" },
  ["c reactive protein", "hs crp", "hscrp"]
);

/** Map a raw lab label to a canonical biomarker, or an `other` slug. */
export function normalizeBiomarker(rawLabel: string): CanonicalBiomarker {
  const key = normalizeKey(rawLabel);
  const hit = SYNONYMS[key];
  if (hit) return hit;
  const slug = key.replace(/\s+/g, "_") || "unknown";
  // Title-case the raw label for display.
  const displayName =
    rawLabel.trim() ||
    slug
      .split("_")
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ");
  return { name: slug, displayName, category: "other" };
}

export interface ExtractedBiomarker {
  rawLabel: string;
  name: string;
  displayName: string;
  category: BiomarkerCategory;
  value: number;
  unit: string | null;
  confidence: number; // 0-1
}

function toNumber(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") {
    const n = Number(v.replace(/,/g, "").trim());
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function clamp01(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return 0.5; // unspecified confidence → middling
  return Math.max(0, Math.min(1, n));
}

/**
 * Validate a raw LLM/parse result (an array of loosely-typed rows) into
 * sane ExtractedBiomarker[]. Rows without a numeric value are dropped;
 * confidence is clamped to 0–1; a missing unit is allowed but pulls
 * confidence down so the reviewer notices.
 */
export function validateExtraction(raw: unknown): ExtractedBiomarker[] {
  const rows = Array.isArray(raw)
    ? raw
    : Array.isArray((raw as { biomarkers?: unknown })?.biomarkers)
      ? (raw as { biomarkers: unknown[] }).biomarkers
      : [];
  const out: ExtractedBiomarker[] = [];
  for (const r of rows) {
    if (typeof r !== "object" || r == null) continue;
    const row = r as Record<string, unknown>;
    const rawLabel =
      typeof row.rawLabel === "string"
        ? row.rawLabel
        : typeof row.label === "string"
          ? row.label
          : typeof row.name === "string"
            ? row.name
            : "";
    if (!rawLabel.trim()) continue;
    const value = toNumber(row.value);
    if (value == null) continue;
    const unit =
      typeof row.unit === "string" && row.unit.trim() ? row.unit.trim() : null;
    let confidence = clamp01(row.confidence);
    if (unit == null) confidence = Math.min(confidence, 0.5);
    const canonical = normalizeBiomarker(rawLabel);
    out.push({ rawLabel, ...canonical, value, unit, confidence });
  }
  return out;
}

/**
 * Deterministic fallback parser for pasted lab text, one biomarker per
 * line: "LABEL ... VALUE UNIT". Used when the user has no LLM configured.
 * Confidence is fixed low (0.5) since there's no model judgement.
 */
export function parseLabText(text: string): ExtractedBiomarker[] {
  const out: ExtractedBiomarker[] = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    // Label is the leading non-numeric text; then a number; then an optional unit.
    const m =
      /^([A-Za-z][A-Za-z0-9()\/%.\- ]*?)[:\s]+(-?\d+(?:\.\d+)?)\s*([A-Za-z%/µ][A-Za-z0-9%/µ^.\-]*)?/.exec(
        trimmed
      );
    if (!m) continue;
    const rawLabel = m[1].trim();
    const value = Number(m[2]);
    if (!Number.isFinite(value)) continue;
    const unit = m[3]?.trim() || null;
    const canonical = normalizeBiomarker(rawLabel);
    out.push({ rawLabel, ...canonical, value, unit, confidence: 0.5 });
  }
  return out;
}

export const EXTRACTION_PROMPT = `You extract lab biomarkers from a blood test.
Return ONLY a JSON object of the form:
{"biomarkers":[{"rawLabel":"LDL Cholesterol","value":95,"unit":"mg/dL","confidence":0.9}]}
Rules:
- One entry per numeric result. Skip reference ranges, headers, and non-numeric notes.
- "value" must be the numeric result only (no unit, no range).
- "unit" is the result's unit as printed, or null if absent.
- "confidence" is 0-1: how sure you are the label and value are correct.
- Do not invent values. If unsure, lower the confidence; never omit the unit if it is printed.
Return the JSON object and nothing else.`;
