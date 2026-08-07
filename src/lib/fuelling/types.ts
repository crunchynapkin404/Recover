export type FuellingConfidence = "high" | "medium" | "low";

export type FuellingIntensityBand =
  | "low"
  | "moderate"
  | "high"
  | "unknown";

export interface FuellingInput {
  durationMins: number | null;
  intensity: string | null;
  type: string | null;
  bodyMassKg: number | null;
}

export interface Range {
  min: number;
  max: number;
}

export interface FuellingGuidance {
  confidence: FuellingConfidence;
  intensityBand: FuellingIntensityBand;
  assumptions: string[];
  before: {
    carbsG: Range;
    note: string;
  };
  during: {
    carbsPerHourG: Range;
    fluidMlPerHour: Range;
    note: string;
  };
  after: {
    carbsG: Range;
    proteinG: Range;
    note: string;
  };
}
