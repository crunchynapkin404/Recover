// ---------- Shared helpers ----------

function parseCSV(text: string): Record<string, string>[] {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const headers = lines[0]
    .split(",")
    .map((h) => h.trim().toLowerCase().replace(/[\s_]+/g, "_"));
  return lines
    .slice(1)
    .filter((l) => l.trim())
    .map((line) => {
      const values = line.split(",").map((v) => v.trim().replace(/^"|"$/g, ""));
      const row: Record<string, string> = {};
      headers.forEach((h, i) => {
        row[h] = values[i] ?? "";
      });
      return row;
    });
}

function tryNumber(val: string | undefined): number | undefined {
  if (!val || val === "") return undefined;
  const n = Number(val);
  return Number.isFinite(n) ? n : undefined;
}

// ---------- Wellness import ----------

export interface WellnessRow {
  date: string;
  hrvMs?: number;
  restingHr?: number;
  sleepHours?: number;
  weightKg?: number;
  energy?: number;
  soreness?: number;
  stress?: number;
}

const WELLNESS_COLUMN_MAP: Record<string, keyof WellnessRow> = {
  date: "date",
  hrv: "hrvMs",
  hrv_ms: "hrvMs",
  "hrv_(ms)": "hrvMs",
  rmssd: "hrvMs",
  resting_hr: "restingHr",
  resting_heart_rate: "restingHr",
  rhr: "restingHr",
  sleep: "sleepHours",
  sleep_hours: "sleepHours",
  sleep_duration: "sleepHours",
  weight: "weightKg",
  weight_kg: "weightKg",
  "weight_(kg)": "weightKg",
  energy: "energy",
  soreness: "soreness",
  stress: "stress",
};

export function parseWellnessCSV(text: string): {
  rows: WellnessRow[];
  errors: string[];
} {
  const raw = parseCSV(text);
  const errors: string[] = [];
  const rows: WellnessRow[] = [];

  if (raw.length === 0) {
    errors.push("CSV is empty or has no data rows.");
    return { rows, errors };
  }

  // Check for date column
  const headers = Object.keys(raw[0]);
  const hasDate = headers.some((h) => WELLNESS_COLUMN_MAP[h] === "date");
  if (!hasDate) {
    errors.push(
      "Missing required 'date' column. Expected headers: date, hrv, resting_hr, sleep_hours, weight_kg, energy, soreness, stress",
    );
    return { rows, errors };
  }

  for (let i = 0; i < raw.length; i++) {
    const r = raw[i];
    const mapped: Record<string, string | undefined> = {};
    for (const [col, val] of Object.entries(r)) {
      const key = WELLNESS_COLUMN_MAP[col];
      if (key) mapped[key] = val;
    }

    if (!mapped.date || !/^\d{4}-\d{2}-\d{2}$/.test(mapped.date)) {
      errors.push(
        `Row ${i + 2}: Invalid or missing date (expected YYYY-MM-DD)`,
      );
      continue;
    }

    const row: WellnessRow = {
      date: mapped.date,
      hrvMs: tryNumber(mapped.hrvMs as string),
      restingHr: tryNumber(mapped.restingHr as string),
      sleepHours: tryNumber(mapped.sleepHours as string),
      weightKg: tryNumber(mapped.weightKg as string),
      energy: tryNumber(mapped.energy as string),
      soreness: tryNumber(mapped.soreness as string),
      stress: tryNumber(mapped.stress as string),
    };

    // At least one value besides date
    const hasValue =
      row.hrvMs != null ||
      row.restingHr != null ||
      row.sleepHours != null ||
      row.weightKg != null ||
      row.energy != null ||
      row.soreness != null ||
      row.stress != null;
    if (!hasValue) {
      errors.push(`Row ${i + 2}: No valid data values found`);
      continue;
    }
    rows.push(row);
  }

  return { rows, errors };
}

// ---------- Activity import ----------

export interface ActivityRow {
  date: string;
  sport: string;
  name?: string;
  durationMinutes?: number;
  distanceKm?: number;
  load?: number;
  avgHr?: number;
  avgPower?: number;
  elevationM?: number;
}

const ACTIVITY_COLUMN_MAP: Record<string, keyof ActivityRow> = {
  date: "date",
  start_date: "date",
  sport: "sport",
  type: "sport",
  activity_type: "sport",
  name: "name",
  title: "name",
  duration: "durationMinutes",
  duration_minutes: "durationMinutes",
  duration_min: "durationMinutes",
  distance: "distanceKm",
  distance_km: "distanceKm",
  load: "load",
  tss: "load",
  training_load: "load",
  avg_hr: "avgHr",
  average_hr: "avgHr",
  heart_rate: "avgHr",
  avg_power: "avgPower",
  average_power: "avgPower",
  power: "avgPower",
  elevation: "elevationM",
  elevation_m: "elevationM",
  elevation_gain: "elevationM",
};

export function parseActivityCSV(text: string): {
  rows: ActivityRow[];
  errors: string[];
} {
  const raw = parseCSV(text);
  const errors: string[] = [];
  const rows: ActivityRow[] = [];

  if (raw.length === 0) {
    errors.push("CSV is empty or has no data rows.");
    return { rows, errors };
  }

  const headers = Object.keys(raw[0]);
  const hasDate = headers.some((h) => ACTIVITY_COLUMN_MAP[h] === "date");
  const hasSport = headers.some((h) => ACTIVITY_COLUMN_MAP[h] === "sport");
  if (!hasDate) {
    errors.push("Missing required 'date' column.");
    return { rows, errors };
  }
  if (!hasSport) {
    errors.push("Missing required 'sport' column.");
    return { rows, errors };
  }

  for (let i = 0; i < raw.length; i++) {
    const r = raw[i];
    const mapped: Record<string, string | undefined> = {};
    for (const [col, val] of Object.entries(r)) {
      const key = ACTIVITY_COLUMN_MAP[col];
      if (key) mapped[key] = val;
    }

    if (!mapped.date || !/^\d{4}-\d{2}-\d{2}$/.test(mapped.date)) {
      errors.push(`Row ${i + 2}: Invalid or missing date`);
      continue;
    }
    if (!mapped.sport) {
      errors.push(`Row ${i + 2}: Missing sport type`);
      continue;
    }

    rows.push({
      date: mapped.date,
      sport: mapped.sport,
      name: mapped.name || undefined,
      durationMinutes: tryNumber(mapped.durationMinutes as string),
      distanceKm: tryNumber(mapped.distanceKm as string),
      load: tryNumber(mapped.load as string),
      avgHr: tryNumber(mapped.avgHr as string),
      avgPower: tryNumber(mapped.avgPower as string),
      elevationM: tryNumber(mapped.elevationM as string),
    });
  }

  return { rows, errors };
}
