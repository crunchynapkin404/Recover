import {
  isReentryStage,
  isSeasonMode,
  type ReentryStage,
  type SeasonMode,
} from "./types";

export function resolveSeasonMode(value: unknown): SeasonMode {
  return isSeasonMode(value) ? value : "normal";
}

export function resolveReentryStage(value: unknown): ReentryStage {
  return isReentryStage(value) ? value : "none";
}

export function normalizeSeasonState(input: {
  seasonMode: unknown;
  reentryStage: unknown;
}): { seasonMode: SeasonMode; reentryStage: ReentryStage } {
  const seasonMode = resolveSeasonMode(input.seasonMode);
  const reentryStage = resolveReentryStage(input.reentryStage);
  if (seasonMode === "normal") {
    return { seasonMode, reentryStage: "none" };
  }
  return { seasonMode, reentryStage };
}
