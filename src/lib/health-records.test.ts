import { describe, expect, it } from "vitest";
import {
  normalizeBiomarker,
  validateExtraction,
  parseLabText,
} from "./health-records";

describe("normalizeBiomarker", () => {
  it("maps synonyms to a canonical name + category", () => {
    expect(normalizeBiomarker("LDL-C").name).toBe("ldl_cholesterol");
    expect(normalizeBiomarker("LDL Cholesterol").category).toBe("lipids");
    expect(normalizeBiomarker("A1C").name).toBe("hba1c");
    expect(normalizeBiomarker("25-OH Vitamin D").name).toBe("vitamin_d");
    expect(normalizeBiomarker("TSH").category).toBe("hormones");
  });

  it("falls back to an 'other' slug for unknown labels", () => {
    const c = normalizeBiomarker("Homocysteine");
    expect(c.category).toBe("other");
    expect(c.name).toBe("homocysteine");
    expect(c.displayName).toBe("Homocysteine");
  });
});

describe("validateExtraction", () => {
  it("accepts a well-formed array and normalizes labels", () => {
    const out = validateExtraction([
      {
        rawLabel: "LDL Cholesterol",
        value: 95,
        unit: "mg/dL",
        confidence: 0.9,
      },
      { rawLabel: "HDL", value: 55, unit: "mg/dL", confidence: 0.85 },
    ]);
    expect(out).toHaveLength(2);
    expect(out[0].name).toBe("ldl_cholesterol");
    expect(out[0].confidence).toBe(0.9);
  });

  it("reads a { biomarkers: [...] } envelope", () => {
    const out = validateExtraction({
      biomarkers: [{ rawLabel: "TSH", value: 2.1, unit: "mIU/L" }],
    });
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe("tsh");
  });

  it("drops rows without a numeric value", () => {
    const out = validateExtraction([
      { rawLabel: "LDL", value: "not a number", unit: "mg/dL" },
      { rawLabel: "HDL", value: 55, unit: "mg/dL" },
      { rawLabel: "", value: 10 },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe("hdl_cholesterol");
  });

  it("parses numeric strings and clamps confidence to 0-1", () => {
    const out = validateExtraction([
      { rawLabel: "Glucose", value: "1,050", unit: "mg/dL", confidence: 5 },
    ]);
    expect(out[0].value).toBe(1050);
    expect(out[0].confidence).toBe(1);
  });

  it("lowers confidence when the unit is missing", () => {
    const out = validateExtraction([
      { rawLabel: "Ferritin", value: 120, confidence: 0.95 },
    ]);
    expect(out[0].unit).toBeNull();
    expect(out[0].confidence).toBeLessThanOrEqual(0.5);
  });

  it("returns [] for non-array input", () => {
    expect(validateExtraction("nope")).toEqual([]);
    expect(validateExtraction(null)).toEqual([]);
  });
});

describe("parseLabText", () => {
  it("parses LABEL VALUE UNIT lines", () => {
    const out = parseLabText(
      `LDL Cholesterol: 95 mg/dL
HDL Cholesterol 55 mg/dL
Triglycerides   88 mg/dL
Some header with no value`
    );
    expect(out.map((b) => b.name)).toEqual([
      "ldl_cholesterol",
      "hdl_cholesterol",
      "triglycerides",
    ]);
    expect(out[0].value).toBe(95);
    expect(out[0].unit).toBe("mg/dL");
    expect(out[0].confidence).toBe(0.5);
  });

  it("handles a unitless value", () => {
    const out = parseLabText("HbA1c: 5.4");
    expect(out).toHaveLength(1);
    expect(out[0].value).toBe(5.4);
    expect(out[0].unit).toBeNull();
  });
});
