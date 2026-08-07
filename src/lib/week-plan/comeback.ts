import type { Band } from "./types";

export type ComebackMode = "none" | "strict" | "step_up";

export interface ComebackDecision {
  mode: ComebackMode;
  loadCapMultiplier: number;
  maxIntensity: "tempo" | null;
  reason: string | null;
}

const SUPPRESSED_BANDS = new Set<Band>(["amber", "red"]);

function isSuppressed(b: Band | undefined): boolean {
  return b != null && SUPPRESSED_BANDS.has(b);
}

function stableStreak(bands: Band[], illFlags: boolean[]): number {
  const n = Math.max(bands.length, illFlags.length);
  let streak = 0;
  for (let i = n - 1; i >= 0; i -= 1) {
    const band = bands[i];
    const ill = illFlags[i] ?? false;
    if (ill || isSuppressed(band)) break;
    streak += 1;
  }
  return streak;
}

export function resolveComebackDecision(input: {
  recentBands: Band[];
  recentIllFlags: boolean[];
  recentLoadDisruption: boolean;
}): ComebackDecision {
  const illInLast7 = input.recentIllFlags.some(Boolean);
  const suppressedNow = isSuppressed(
    input.recentBands[input.recentBands.length - 1]
  );
  const entry = illInLast7 || (suppressedNow && input.recentLoadDisruption);

  if (!entry) {
    return {
      mode: "none",
      loadCapMultiplier: 1,
      maxIntensity: null,
      reason: null,
    };
  }

  const stable = stableStreak(input.recentBands, input.recentIllFlags);
  if (stable >= 2) {
    return {
      mode: "step_up",
      loadCapMultiplier: 0.85,
      maxIntensity: "tempo",
      reason:
        "illness comeback: 2 stable days reached, stepping up to 85% cap while keeping intensity at tempo or below",
    };
  }

  return {
    mode: "strict",
    loadCapMultiplier: 0.7,
    maxIntensity: "tempo",
    reason:
      "illness comeback: conservative mode active (70% cap, no intensity above tempo)",
  };
}
