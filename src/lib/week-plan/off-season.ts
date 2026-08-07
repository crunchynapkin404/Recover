import { withPurpose, type PlannedWorkout } from "@/lib/training-plan";
import type { ReentryStage, SeasonMode } from "@/lib/season-mode/types";

const QUALITY = new Set(["Intervals", "Tempo", "Brick"]);

function downgradeToEndurance(w: PlannedWorkout): PlannedWorkout {
  return withPurpose({
    ...w,
    type: "Endurance",
    intensity: "Z1-Z2",
    description: `Off-season density cap: ${w.description}`,
  });
}

export function applyOffSeasonShaping(input: {
  workouts: PlannedWorkout[];
  seasonMode: SeasonMode;
  reentryStage: ReentryStage;
  targetSessions: number;
}): { workouts: PlannedWorkout[]; targetSessions: number } {
  if (input.seasonMode === "normal" && input.reentryStage === "none") {
    return { workouts: input.workouts, targetSessions: input.targetSessions };
  }

  const maxQuality = input.reentryStage === "week_2" ? 2 : 1;

  let seenQuality = 0;
  const shaped = input.workouts.map((w) => {
    if (!QUALITY.has(w.type)) return w;
    if (input.reentryStage === "week_1" && w.type === "Intervals") {
      return downgradeToEndurance(w);
    }
    seenQuality += 1;
    return seenQuality <= maxQuality ? w : downgradeToEndurance(w);
  });

  const reducedSessions = Math.max(3, input.targetSessions - 1);
  return {
    workouts: shaped,
    targetSessions:
      input.seasonMode === "off_season"
        ? reducedSessions
        : input.targetSessions,
  };
}
