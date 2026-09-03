import { describe, it, expect } from "vitest";
import { recommendWorkouts, type RecommendContext } from "./recommend";
import { LIBRARY } from "./library";

const base: RecommendContext = {
  band: "green",
  daysSinceQuality: 3,
  weekLoadFraction: 0.5,
  recentFamilies: [],
};

const purposeOf = (id: string) => LIBRARY.find((w) => w.id === id)!.purpose;
const familyOf = (id: string) => LIBRARY.find((w) => w.id === id)!.family;

describe("recommendWorkouts", () => {
  it("ranks, never filters — every workout stays pickable", () => {
    expect(recommendWorkouts(base)).toHaveLength(LIBRARY.length);
  });

  it("returns each workout exactly once", () => {
    const ids = recommendWorkouts(base).map((r) => r.workoutId);
    expect(new Set(ids).size).toBe(LIBRARY.length);
  });

  it("puts recovery first on a red band", () => {
    expect(
      purposeOf(recommendWorkouts({ ...base, band: "red" })[0].workoutId)
    ).toBe("recovery");
  });

  it("does not put quality first the day after quality", () => {
    const top = recommendWorkouts({ ...base, daysSinceQuality: 1 })[0];
    expect(["threshold", "vo2max"]).not.toContain(purposeOf(top.workoutId));
  });

  it("does put quality first when the athlete is fresh and rested", () => {
    // The mirror of the test above — without it, a scorer that simply never
    // recommends quality would pass, and the pair is what makes either mean
    // anything.
    const top = recommendWorkouts({ ...base, daysSinceQuality: 5 })[0];
    expect(["threshold", "vo2max"]).toContain(purposeOf(top.workoutId));
  });

  it("demotes a family ridden recently", () => {
    const fam = familyOf(recommendWorkouts(base)[0].workoutId);
    const rankOf = (rs: { workoutId: string }[]) =>
      rs.findIndex((r) => familyOf(r.workoutId) === fam);
    expect(
      rankOf(recommendWorkouts({ ...base, recentFamilies: [fam] }))
    ).toBeGreaterThan(rankOf(recommendWorkouts(base)));
  });

  it("prefers shorter work when the week is already over target", () => {
    const over = recommendWorkouts({ ...base, weekLoadFraction: 1.4 })[0];
    expect(["recovery", "aerobic_base"]).toContain(purposeOf(over.workoutId));
  });

  it("gives every recommendation a why sentence", () => {
    expect(recommendWorkouts(base).every((r) => r.why.length > 0)).toBe(true);
  });

  it("never says watts — targets are always % of FTP", () => {
    expect(recommendWorkouts(base).some((r) => /watt/i.test(r.why))).toBe(
      false
    );
  });

  it("is deterministic", () => {
    expect(recommendWorkouts(base)).toEqual(recommendWorkouts(base));
  });

  it("ranks from 0 upward with no gaps", () => {
    const ranks = recommendWorkouts(base).map((r) => r.rank);
    expect(ranks).toEqual(ranks.map((_, i) => i));
  });

  it("treats a calibrating band as cautiously as amber, not as green", () => {
    // readiness.ts has four bands, not three. A scorer keyed only on
    // green/amber/red silently treats "calibrating" as green — the most
    // permissive answer — for an athlete Recover admits it cannot read yet.
    const top = recommendWorkouts({
      ...base,
      band: "calibrating",
      daysSinceQuality: 5,
    })[0];
    expect(["threshold", "vo2max"]).not.toContain(purposeOf(top.workoutId));
  });
});
