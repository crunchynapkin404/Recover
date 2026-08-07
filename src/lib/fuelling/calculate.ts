import type {
  FuellingGuidance,
  FuellingInput,
  FuellingIntensityBand,
  FuellingConfidence,
  Range,
} from "./types";

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
  if (durationMins <= 60) return "short";
  if (durationMins <= 120) return "medium";
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
    min: clamp(range.min + 5, 0, 300),
    max: clamp(range.max + 15, 0, 300),
  };
}

function beforeCarbs(
  duration: "short" | "medium" | "long",
  intensity: FuellingIntensityBand
): Range {
  const base: Record<typeof duration, Range> = {
    short: { min: 20, max: 30 },
    medium: { min: 30, max: 50 },
    long: { min: 50, max: 70 },
  };
  return adjustForHighIntensity(base[duration], intensity);
}

function duringCarbs(
  duration: "short" | "medium" | "long",
  intensity: FuellingIntensityBand
): Range {
  const base: Record<typeof duration, Range> = {
    short: { min: 0, max: 20 },
    medium: { min: 30, max: 45 },
    long: { min: 45, max: 60 },
  };
  const adjusted = adjustForHighIntensity(base[duration], intensity);
  return {
    min: clamp(adjusted.min, 0, 90),
    max: clamp(adjusted.max, 0, 90),
  };
}

function duringFluid(
  duration: "short" | "medium" | "long",
  intensity: FuellingIntensityBand
): Range {
  const base: Record<typeof duration, Range> = {
    short: { min: 400, max: 600 },
    medium: { min: 500, max: 700 },
    long: { min: 600, max: 800 },
  };
  if (intensity !== "high") return base[duration];
  return {
    min: clamp(base[duration].min + 100, 0, 1200),
    max: clamp(base[duration].max + 100, 0, 1200),
  };
}

function afterCarbs(
  duration: "short" | "medium" | "long",
  bodyMassKg: number | null
): Range {
  if (bodyMassKg == null) {
    const generic: Record<typeof duration, Range> = {
      short: { min: 30, max: 45 },
      medium: { min: 45, max: 65 },
      long: { min: 60, max: 85 },
    };
    return generic[duration];
  }

  const factors: Record<typeof duration, Range> = {
    short: { min: 0.6, max: 0.8 },
    medium: { min: 0.8, max: 1.0 },
    long: { min: 1.0, max: 1.2 },
  };
  return {
    min: round5(factors[duration].min * bodyMassKg),
    max: round5(factors[duration].max * bodyMassKg),
  };
}

function afterProtein(bodyMassKg: number | null): Range {
  if (bodyMassKg == null) return { min: 20, max: 35 };
  return {
    min: round5(bodyMassKg * 0.25),
    max: round5(bodyMassKg * 0.35),
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

  const band = durationBand(durationMins > 0 ? durationMins : 60);

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
