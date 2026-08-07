import { and, desc, eq, gte, ne } from "drizzle-orm";
import { canonicalSport } from "@/lib/canonical-sport";
import { db, schema } from "@/lib/db";
import type { PlanSport } from "@/lib/plan-sport";
import {
  MIN_LOAD_DAYS,
  nativeLoadMetrics,
  type AthleteThresholds,
  type LoadActivity,
} from "@/lib/training-load";

export type StartStateSource =
  "persisted" | "wellness" | "sport_rolling" | "global_fallback";

export interface StartStateSnapshot {
  startingCtl: number;
  startingAtl: number;
  startingTsb: number;
  ctlSource: StartStateSource;
  atlSource: StartStateSource;
  warnings: string[];
}

const GLOBAL_FALLBACK_CTL = 30;
const GLOBAL_FALLBACK_ATL = 40;
const SPORT_ROLLING_WINDOW_DAYS = 180;

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

function ymd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function sportDisciplineSet(sport: PlanSport): Set<string> {
  if (sport === "Bike") return new Set(["Bike"]);
  if (sport === "Run") return new Set(["Run"]);
  return new Set(["Bike", "Run", "Swim"]);
}

function toLoadActivity(
  rows: Array<{
    provider: "intervals_icu" | "strava" | "manual";
    startDate: Date;
    startDateLocal: Date | null;
    durationS: number | null;
    load: number | null;
    avgHr: number | null;
    avgPower: number | null;
    sport: string;
  }>
): LoadActivity[] {
  return rows.map((r) => ({
    provider: r.provider,
    startDate: r.startDate,
    startDateLocal: r.startDateLocal,
    durationS: r.durationS,
    load: r.load,
    avgHr: r.avgHr,
    avgPower: r.avgPower,
  }));
}

function pickPersisted(
  constraints: unknown
): Omit<StartStateSnapshot, "warnings"> | null {
  if (!constraints || typeof constraints !== "object") return null;
  const root = constraints as {
    startState?: {
      startingCtl?: number;
      startingAtl?: number;
      startingTsb?: number;
      ctlSource?: StartStateSource;
      atlSource?: StartStateSource;
    };
  };

  const s = root.startState;
  if (!s) return null;
  if (typeof s.startingCtl !== "number" || !Number.isFinite(s.startingCtl)) {
    return null;
  }
  if (typeof s.startingAtl !== "number" || !Number.isFinite(s.startingAtl)) {
    return null;
  }
  const startingCtl = round1(s.startingCtl);
  const startingAtl = round1(s.startingAtl);
  const startingTsb = round1(
    typeof s.startingTsb === "number" && Number.isFinite(s.startingTsb)
      ? s.startingTsb
      : startingCtl - startingAtl
  );

  return {
    startingCtl,
    startingAtl,
    startingTsb,
    ctlSource: "persisted",
    atlSource: "persisted",
  };
}

export function resolveStartStateFromInputs(args: {
  persisted: Omit<StartStateSnapshot, "warnings"> | null;
  wellness: { ctl: number | null; atl: number | null } | null;
  sportRolling: { ctl: number; atl: number; activityDays: number } | null;
}): StartStateSnapshot {
  if (args.persisted) {
    return { ...args.persisted, warnings: [] };
  }

  if (
    args.wellness?.ctl != null &&
    Number.isFinite(args.wellness.ctl) &&
    args.wellness?.atl != null &&
    Number.isFinite(args.wellness.atl)
  ) {
    const startingCtl = round1(args.wellness.ctl);
    const startingAtl = round1(args.wellness.atl);
    return {
      startingCtl,
      startingAtl,
      startingTsb: round1(startingCtl - startingAtl),
      ctlSource: "wellness",
      atlSource: "wellness",
      warnings: [],
    };
  }

  if (
    args.sportRolling &&
    Number.isFinite(args.sportRolling.ctl) &&
    Number.isFinite(args.sportRolling.atl) &&
    args.sportRolling.activityDays >= MIN_LOAD_DAYS
  ) {
    const startingCtl = round1(args.sportRolling.ctl);
    const startingAtl = round1(args.sportRolling.atl);
    return {
      startingCtl,
      startingAtl,
      startingTsb: round1(startingCtl - startingAtl),
      ctlSource: "sport_rolling",
      atlSource: "sport_rolling",
      warnings: ["no_wellness_load_pair"],
    };
  }

  return {
    startingCtl: GLOBAL_FALLBACK_CTL,
    startingAtl: GLOBAL_FALLBACK_ATL,
    startingTsb: round1(GLOBAL_FALLBACK_CTL - GLOBAL_FALLBACK_ATL),
    ctlSource: "global_fallback",
    atlSource: "global_fallback",
    warnings: ["no_wellness_load_pair", "no_sport_history"],
  };
}

export async function resolveStartStateForUser(args: {
  userId: string;
  sport: PlanSport;
  constraints?: unknown;
  asOf?: Date;
}): Promise<StartStateSnapshot> {
  const asOf = args.asOf ?? new Date();
  const todayYmd = ymd(asOf);

  const persisted = pickPersisted(args.constraints ?? null);

  const wellnessRow = await db.query.wellnessDaily.findFirst({
    where: eq(schema.wellnessDaily.userId, args.userId),
    orderBy: desc(schema.wellnessDaily.date),
    columns: { ctl: true, atl: true },
  });
  const wellness = wellnessRow ?? null;

  const since = new Date(asOf);
  since.setDate(since.getDate() - SPORT_ROLLING_WINDOW_DAYS);

  const admitted = sportDisciplineSet(args.sport);
  const activities = await db.query.activities.findMany({
    where: and(
      eq(schema.activities.userId, args.userId),
      gte(schema.activities.startDate, since),
      ne(schema.activities.provider, "strava")
    ),
    columns: {
      provider: true,
      startDate: true,
      startDateLocal: true,
      durationS: true,
      load: true,
      avgHr: true,
      avgPower: true,
      sport: true,
    },
  });

  const sportRows = activities.filter((a) =>
    admitted.has(canonicalSport(a.sport))
  );

  const thresholds: AthleteThresholds = {
    ftpWatts: null,
    maxHr: null,
    restingHr: null,
  };

  const metrics = nativeLoadMetrics(
    toLoadActivity(sportRows),
    thresholds,
    todayYmd
  );
  const sportRolling = metrics.get(todayYmd) ?? null;

  return resolveStartStateFromInputs({ persisted, wellness, sportRolling });
}
