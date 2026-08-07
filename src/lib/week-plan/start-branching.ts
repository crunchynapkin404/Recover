export type FormBucket =
  | "deep_negative"
  | "moderate_negative"
  | "neutral_positive";

export type OpeningBranch = "recovery_first" | "reduced_build" | "normal_build";

export interface OpeningDecision {
  bucket: FormBucket;
  branch: OpeningBranch;
  loadMultiplier: number;
  weekHoursMultiplier: number;
}

const FIRST_72H_DAY_INDEX_EXCLUSIVE = 3;

export function resolveFormBucket(tsb: number): FormBucket {
  if (tsb <= -20) return "deep_negative";
  if (tsb <= -10) return "moderate_negative";
  return "neutral_positive";
}

export function resolveOpeningDecision(
  startingTsb: number | null | undefined
): OpeningDecision {
  if (startingTsb == null || !Number.isFinite(startingTsb)) {
    return {
      bucket: "neutral_positive",
      branch: "normal_build",
      loadMultiplier: 1,
      weekHoursMultiplier: 1,
    };
  }

  const bucket = resolveFormBucket(startingTsb);
  if (bucket === "deep_negative") {
    return {
      bucket,
      branch: "recovery_first",
      loadMultiplier: 0.8,
      weekHoursMultiplier: 0.8,
    };
  }
  if (bucket === "moderate_negative") {
    return {
      bucket,
      branch: "reduced_build",
      loadMultiplier: 0.9,
      weekHoursMultiplier: 0.9,
    };
  }
  return {
    bucket,
    branch: "normal_build",
    loadMultiplier: 1,
    weekHoursMultiplier: 1,
  };
}

type WorkoutLike = {
  day: number;
  type: string;
  intensity: string;
  description: string;
};

function downgradeToEndurance<T extends WorkoutLike>(w: T): T {
  return {
    ...w,
    type: "Endurance",
    intensity: "Z1-Z2",
    description: `Opening week: ${w.description}`,
  };
}

function downgradeToRecovery<T extends WorkoutLike>(w: T): T {
  return {
    ...w,
    type: "Recovery",
    intensity: "Recovery",
    description: `Opening week recovery: ${w.description}`,
  };
}

export function applyOpeningWorkoutRules<T extends WorkoutLike>(
  workouts: T[],
  branch: OpeningBranch
): T[] {
  if (branch === "normal_build") return workouts;

  return workouts.map((w) => {
    if (w.day >= FIRST_72H_DAY_INDEX_EXCLUSIVE) return w;

    const highIntensity = w.type === "Intervals" || w.type === "Tempo";

    if (branch === "reduced_build") {
      return highIntensity ? downgradeToEndurance(w) : w;
    }

    if (w.type === "Recovery") return w;
    if (highIntensity) return downgradeToRecovery(w);
    return downgradeToEndurance(w);
  });
}
