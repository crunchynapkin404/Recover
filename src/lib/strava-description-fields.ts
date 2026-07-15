/**
 * v0.6.2 — user-selectable fields for Strava descriptions.
 *
 * Zero imports on purpose: db/schema.ts types the JSONB column with
 * DescriptionFields, and strava-describer.ts imports db/schema. Anything
 * imported here risks a cycle.
 */

export type DescriptionField =
  | "header" // sport emoji + activity title
  | "load" // TL
  | "intensity" // IF %
  | "trimp"
  | "powerHrRatio" // Pw:Hr
  | "decoupling"
  | "pace" // runs only
  | "carbs"
  | "ctl"
  | "tsb"
  | "eftp"
  | "vo2max"
  | "prs";

/** null/undefined = every field enabled (v0.6 behavior, byte-identical). */
export type DescriptionFields = Partial<
  Record<DescriptionField, boolean>
> | null;

/** Ordered for the settings checklist; labels are user-facing. */
export const ALL_DESCRIPTION_FIELDS: ReadonlyArray<{
  key: DescriptionField;
  label: string;
}> = [
  { key: "header", label: "Title header" },
  { key: "load", label: "Training load (TL)" },
  { key: "intensity", label: "Intensity (IF)" },
  { key: "trimp", label: "TRIMP" },
  { key: "powerHrRatio", label: "Pw:Hr efficiency" },
  { key: "decoupling", label: "Decoupling" },
  { key: "pace", label: "Pace (runs)" },
  { key: "carbs", label: "Carbs" },
  { key: "ctl", label: "CTL" },
  { key: "tsb", label: "TSB" },
  { key: "eftp", label: "eFTP" },
  { key: "vo2max", label: "VO2max" },
  { key: "prs", label: "Personal records" },
];

/**
 * Allowlist: enabled iff the key is present AND exactly true. A saved config
 * never auto-adopts fields added by a later version — descriptions are public.
 * A null/undefined config means the user never customized: everything on.
 */
export function isFieldEnabled(
  fields: DescriptionFields | undefined,
  key: DescriptionField
): boolean {
  if (fields == null) return true;
  return fields[key] === true;
}

/**
 * Narrow untrusted client input to a storable allowlist. Keys off
 * ALL_DESCRIPTION_FIELDS so unknown keys are dropped rather than written into
 * JSONB. Only `true` survives, keeping stored objects compact.
 */
export function sanitizeDescriptionFields(
  input: unknown
): Partial<Record<DescriptionField, boolean>> {
  const out: Partial<Record<DescriptionField, boolean>> = {};
  if (input == null || typeof input !== "object") return out;
  const rec = input as Record<string, unknown>;
  for (const { key } of ALL_DESCRIPTION_FIELDS) {
    if (rec[key] === true) out[key] = true;
  }
  return out;
}
