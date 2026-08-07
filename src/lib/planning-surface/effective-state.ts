import { resolvePlanStyle } from "@/lib/plan-style/resolve";
import { normalizeSeasonState } from "@/lib/season-mode/resolve";
import type { PlanStyle } from "@/lib/plan-style/types";
import type { ReentryStage, SeasonMode } from "@/lib/season-mode/types";

export interface PlanningSurfaceState {
  effectiveStyle: PlanStyle;
  effectiveSeasonMode: SeasonMode;
  reentryStage: ReentryStage;
}

export function resolvePlanningSurfaceState(
  constraints: Record<string, unknown> | null | undefined
): PlanningSurfaceState {
  const c = constraints ?? {};
  const season = normalizeSeasonState({
    seasonMode: c.seasonMode,
    reentryStage: c.reentryStage,
  });
  return {
    effectiveStyle: resolvePlanStyle(c.planStyle),
    effectiveSeasonMode: season.seasonMode,
    reentryStage: season.reentryStage,
  };
}
