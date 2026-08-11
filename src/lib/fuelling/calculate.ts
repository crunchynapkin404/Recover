import type {
  FuellingGuidance,
  FuellingInput,
  FuellingIntensityBand,
  FuellingConfidence,
  Range,
} from "./types";
import {
  AFTER_CARBS_G_NO_MASS,
  ASSUMED_DURATION_MINS,
  AFTER_CARBS_G_PER_KG,
  AFTER_PROTEIN_G_NO_MASS,
  AFTER_PROTEIN_G_PER_KG,
  BEFORE_CARBS_G,
  CARB_ADJUST_MAX_G,
  DURATION_BAND_MINS,
  DURING_CARBS_G_PER_HOUR,
  DURING_CARBS_MAX_G_PER_HOUR,
  DURING_FLUID_MAX_ML_PER_HOUR,
  DURING_FLUID_ML_PER_HOUR,
  HIGH_INTENSITY_CARB_BONUS_G,
  HIGH_INTENSITY_FLUID_BONUS_ML,
} from "./fuelling-constants";

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function round5(n: number): number {
  return Math.round(n / 5) * 5;
}

function classifyIntensity(input: FuellingInput): FuellingIntensityBand {
  const intensity = (input.intensity ?? "").toUpperCase();
  const type = (input.type ?? "").toLowerCase();

  if (type === "intervals" || type === "tempo" || type === "brick") {
    return "high";
  }
  if (intensity.includes("Z4") || intensity.includes("Z5")) return "high";
  if (intensity.includes("Z3")) return "moderate";
  if (
    type === "recovery" ||
    intensity.includes("RECOVERY") ||
    intensity.includes("Z1") ||
    intensity.includes("Z2")
  ) {
    return "low";
  }
  return "unknown";
}

function durationBand(durationMins: number): "short" | "medium" | "long" {
  if (durationMins <= DURATION_BAND_MINS.short) return "short";
  if (durationMins <= DURATION_BAND_MINS.medium) return "medium";
  return "long";
}

function confidenceOf(
  input: FuellingInput,
  band: FuellingIntensityBand
): FuellingConfidence {
  if ((input.durationMins ?? 0) <= 0 || band === "unknown") return "low";
  if (input.bodyMassKg == null) return "medium";
  return "high";
}

function adjustForHighIntensity(
  range: Range,
  band: FuellingIntensityBand
): Range {
  if (band !== "high") return range;
  return {
    min: clamp(
      range.min + HIGH_INTENSITY_CARB_BONUS_G.min,
      0,
      CARB_ADJUST_MAX_G
    ),
    max: clamp(
      range.max + HIGH_INTENSITY_CARB_BONUS_G.max,
      0,
      CARB_ADJUST_MAX_G
    ),
  };
}

function beforeCarbs(
  duration: "short" | "medium" | "long",
  intensity: FuellingIntensityBand
): Range {
  return adjustForHighIntensity(BEFORE_CARBS_G[duration], intensity);
}

function duringCarbs(
  duration: "short" | "medium" | "long",
  intensity: FuellingIntensityBand
): Range {
  const adjusted = adjustForHighIntensity(
    DURING_CARBS_G_PER_HOUR[duration],
    intensity
  );
  return {
    min: clamp(adjusted.min, 0, DURING_CARBS_MAX_G_PER_HOUR),
    max: clamp(adjusted.max, 0, DURING_CARBS_MAX_G_PER_HOUR),
  };
}

function duringFluid(
  duration: "short" | "medium" | "long",
  intensity: FuellingIntensityBand
): Range {
  const base = DURING_FLUID_ML_PER_HOUR[duration];
  if (intensity !== "high") return base;
  return {
    min: clamp(
      base.min + HIGH_INTENSITY_FLUID_BONUS_ML,
      0,
      DURING_FLUID_MAX_ML_PER_HOUR
    ),
    max: clamp(
      base.max + HIGH_INTENSITY_FLUID_BONUS_ML,
      0,
      DURING_FLUID_MAX_ML_PER_HOUR
    ),
  };
}

function afterCarbs(
  duration: "short" | "medium" | "long",
  bodyMassKg: number | null
): Range {
  if (bodyMassKg == null) {
    return AFTER_CARBS_G_NO_MASS[duration];
  }

  const factors = AFTER_CARBS_G_PER_KG[duration];
  return {
    min: round5(factors.min * bodyMassKg),
    max: round5(factors.max * bodyMassKg),
  };
}

function afterProtein(bodyMassKg: number | null): Range {
  if (bodyMassKg == null) return AFTER_PROTEIN_G_NO_MASS;
  return {
    min: round5(bodyMassKg * AFTER_PROTEIN_G_PER_KG.min),
    max: round5(bodyMassKg * AFTER_PROTEIN_G_PER_KG.max),
  };
}

export function calculateFuellingGuidance(
  input: FuellingInput
): FuellingGuidance {
  const durationMins = input.durationMins ?? 0;
  const intensityBand = classifyIntensity(input);
  const confidence = confidenceOf(input, intensityBand);
  const assumptions: string[] = [];

  if (durationMins <= 0) {
    assumptions.push("duration missing; conservative fallback used");
  }
  if (intensityBand === "unknown") {
    assumptions.push("intensity missing or unknown; medium-dose fallback used");
  }
  if (input.bodyMassKg == null) {
    assumptions.push("body mass missing; generic recovery ranges used");
  }

  const band = durationBand(
    durationMins > 0 ? durationMins : ASSUMED_DURATION_MINS
  );

  return {
    confidence,
    intensityBand,
    assumptions,
    before: {
      carbsG: beforeCarbs(band, intensityBand),
      note: "30-60 min pre-session",
    },
    during: {
      carbsPerHourG: duringCarbs(band, intensityBand),
      fluidMlPerHour: duringFluid(band, intensityBand),
      note: "split into regular small sips/feeds",
    },
    after: {
      carbsG: afterCarbs(band, input.bodyMassKg),
      proteinG: afterProtein(input.bodyMassKg),
      note: "within 60 min after session",
    },
  };
}
