/**
 * Prints real demand output for READING, not asserting.
 *
 * Every one of v0.45's four genuine defects was code that worked, passed its
 * tests, and quietly did something else — an extra loading week per
 * mesocycle, a 12-week plan losing its peak phase entirely, a cold-start race
 * week at 20% of intended load. All four were caught by looking at
 * week-by-week output. None were caught by a test.
 *
 * Run: npx tsx scripts/demand-sweep.ts
 */
import { eventDemand } from "../src/lib/race/demand";
import { estimateRunningHours } from "../src/lib/race/running-time";
import { estimateSwimHours } from "../src/lib/race/swim-time";
import { triathlonLegsFor } from "../src/lib/race/triathlon-legs";

const hhmm = (h: number) =>
  `${Math.floor(h)}:${String(Math.round((h % 1) * 60)).padStart(2, "0")}`;

console.log("\n=== MARATHON, by threshold pace and climbing ===");
console.log("pace(s/km)  flat    +500m   +1000m  +2000m");
for (const secPerKm of [240, 270, 300, 330]) {
  const row = [0, 500, 1000, 2000].map((elevationM) => {
    const h = estimateRunningHours({
      distanceKm: 42.2,
      elevationM,
      thresholdPaceSecPerKm: secPerKm,
    })!;
    return hhmm(h).padEnd(8);
  });
  console.log(`${String(secPerKm).padEnd(11)} ${row.join("")}`);
}

console.log("\n=== TRIATHLON, leg by leg ===");
for (const raceType of ["ironman", "70.3"]) {
  const legs = triathlonLegsFor(raceType)!;
  const swim = estimateSwimHours(legs.swimKm, 120)!;
  const run = estimateRunningHours({
    distanceKm: legs.runKm,
    elevationM: 0,
    thresholdPaceSecPerKm: 300,
  })!;
  const total = eventDemand({
    sport: "Triathlon",
    raceType,
    eventDays: 1,
    distanceKm: null,
    elevationM: 0,
    stages: [],
    overrideWeeklyHours: null,
    expectedFinishHours: null,
    ftp: { watts: 250, athleteSet: true },
    massKg: 83,
    runPace: { secPerKm: 300, athleteSet: true },
    swimPace: { secPer100m: 120, athleteSet: true },
  });
  if (!total.available) {
    console.log(`${raceType}: UNAVAILABLE (${total.reason})`);
    continue;
  }
  // Bike printed as the remainder so a dropped or double-counted leg shows.
  const bike = total.totalHours - swim - run;
  console.log(
    `${raceType.padEnd(9)} swim ${hhmm(swim)}  bike ${hhmm(bike)}  run ${hhmm(run)}  TOTAL ${hhmm(total.totalHours)}  weekly ${total.weeklyHours.toFixed(2)}h  [${total.confidence}]`
  );
}

console.log("\n=== FONDO FREEZE (must equal the Task 4 recorded values) ===");
const fondo = eventDemand({
  sport: "Bike",
  raceType: "gran_fondo",
  eventDays: 1,
  distanceKm: 130,
  elevationM: 4000,
  stages: [],
  overrideWeeklyHours: null,
  expectedFinishHours: null,
  ftp: { watts: 310, athleteSet: true },
  massKg: 83,
  runPace: null,
  swimPace: null,
});
console.log(JSON.stringify(fondo, null, 2));
