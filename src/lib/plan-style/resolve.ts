import { isPlanStyle, type PlanStyle } from "./types";

export function resolvePlanStyle(value: unknown): PlanStyle {
  return isPlanStyle(value) ? value : "balanced";
}
