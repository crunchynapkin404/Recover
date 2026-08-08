/**
 * Shared "does the app know this, and how well" type for athlete-facing
 * numbers (UI, coach context, MCP tool returns) — see
 * docs/specs/2026-08-08-uncertainty-vocabulary-design.md. Promotes the
 * discriminated-union shape src/lib/race/demand.ts's EventDemandResult
 * already proved for one number to house style, so a caller cannot consume
 * an athlete-facing figure without handling the case where it isn't one.
 */

export type Confidence = "low" | "medium" | "high";

export type CalibratingUnit = "days" | "nights" | "sessions";

export type Unavailable =
  | { kind: "calibrating"; have: number; need: number; unit: CalibratingUnit }
  | {
      kind: "missing_input";
      needs: string;
      fix?: { label: string; href: string };
    }
  | { kind: "not_applicable"; why: string };

export type Figure<T> =
  | { available: true; value: T; confidence: Confidence; why?: string }
  | ({ available: false } & Unavailable);

export const Figure = {
  available: <T>(
    value: T,
    confidence: Confidence,
    why?: string
  ): Figure<T> => ({ available: true, value, confidence, why }),

  calibrating: (
    have: number,
    need: number,
    unit: CalibratingUnit
  ): Figure<never> => ({
    available: false,
    kind: "calibrating",
    have,
    need,
    unit,
  }),

  missingInput: (
    needs: string,
    fix?: { label: string; href: string }
  ): Figure<never> => ({ available: false, kind: "missing_input", needs, fix }),

  notApplicable: (why: string): Figure<never> => ({
    available: false,
    kind: "not_applicable",
    why,
  }),
};
