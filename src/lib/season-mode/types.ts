export const SEASON_MODES = ["normal", "off_season"] as const;
export type SeasonMode = (typeof SEASON_MODES)[number];

export const REENTRY_STAGES = ["none", "week_1", "week_2"] as const;
export type ReentryStage = (typeof REENTRY_STAGES)[number];

export function isSeasonMode(v: unknown): v is SeasonMode {
  return v === "normal" || v === "off_season";
}

export function isReentryStage(v: unknown): v is ReentryStage {
  return v === "none" || v === "week_1" || v === "week_2";
}
