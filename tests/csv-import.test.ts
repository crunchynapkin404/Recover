import { describe, expect, it } from "vitest";
import { parseWellnessCSV, parseActivityCSV } from "@/lib/csv-import";

describe("parseWellnessCSV", () => {
  it("parses valid wellness CSV", () => {
    const csv = `date,hrv,resting_hr,sleep_hours,weight_kg
2024-01-01,55,60,7.5,72
2024-01-02,58,59,8,71.5`;
    const { rows, errors } = parseWellnessCSV(csv);
    expect(errors).toEqual([]);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({
      date: "2024-01-01",
      hrvMs: 55,
      restingHr: 60,
      sleepHours: 7.5,
      weightKg: 72,
      energy: undefined,
      soreness: undefined,
      stress: undefined,
    });
  });

  it("rejects CSV without date column", () => {
    const csv = `hrv,resting_hr\n55,60`;
    const { rows, errors } = parseWellnessCSV(csv);
    expect(rows).toHaveLength(0);
    expect(errors[0]).toContain("date");
  });

  it("skips rows with invalid dates", () => {
    const csv = `date,hrv\nbad-date,55\n2024-01-01,60`;
    const { rows, errors } = parseWellnessCSV(csv);
    expect(rows).toHaveLength(1);
    expect(errors).toHaveLength(1);
  });

  it("handles empty CSV", () => {
    const { rows, errors } = parseWellnessCSV("");
    expect(rows).toHaveLength(0);
    expect(errors).toHaveLength(1);
  });

  it("handles alternative column names", () => {
    const csv = `date,rmssd,rhr\n2024-01-01,55,60`;
    const { rows } = parseWellnessCSV(csv);
    expect(rows[0].hrvMs).toBe(55);
    expect(rows[0].restingHr).toBe(60);
  });
});

describe("parseActivityCSV", () => {
  it("parses valid activity CSV", () => {
    const csv = `date,sport,name,duration_minutes,distance_km
2024-01-01,Ride,Morning ride,60,30`;
    const { rows, errors } = parseActivityCSV(csv);
    expect(errors).toEqual([]);
    expect(rows).toHaveLength(1);
    expect(rows[0].sport).toBe("Ride");
    expect(rows[0].durationMinutes).toBe(60);
  });

  it("requires both date and sport columns", () => {
    const csv = `date,name\n2024-01-01,Test`;
    const { errors } = parseActivityCSV(csv);
    expect(errors[0]).toContain("sport");
  });
});
