export const PLAN_STYLES = ["balanced", "block_lite"] as const;

export type PlanStyle = (typeof PLAN_STYLES)[number];

export function isPlanStyle(v: unknown): v is PlanStyle {
  return v === "balanced" || v === "block_lite";
}
