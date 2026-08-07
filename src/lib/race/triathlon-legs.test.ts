import { describe, expect, it } from "vitest";
import { triathlonLegsFor } from "./triathlon-legs";

describe("triathlonLegsFor", () => {
  it("knows the standard Ironman distances", () => {
    expect(triathlonLegsFor("ironman")).toEqual({
      swimKm: 3.8,
      bikeKm: 180,
      runKm: 42.2,
    });
  });

  it("collapses every spelling of the same format onto one key", () => {
    // This is F7: free text from the race form and the plan tool's closed
    // enum must reach the same row, or a triathlon prices as nothing.
    const canonical = triathlonLegsFor("70.3");
    expect(triathlonLegsFor("Half Ironman")).toEqual(canonical);
    expect(triathlonLegsFor("half_ironman")).toEqual(canonical);
    expect(triathlonLegsFor("HalfIronman")).toEqual(canonical);
  });

  it("keeps the dot in 70.3 rather than treating it as a separator", () => {
    expect(triathlonLegsFor("70.3")).not.toBeNull();
    expect(triathlonLegsFor("70.3")!.bikeKm).toBe(90);
  });

  it("knows Olympic and Sprint under both spellings", () => {
    expect(triathlonLegsFor("olympic_tri")).toEqual({
      swimKm: 1.5,
      bikeKm: 40,
      runKm: 10,
    });
    expect(triathlonLegsFor("olympic triathlon")).toEqual(
      triathlonLegsFor("olympic_tri")
    );
    expect(triathlonLegsFor("sprint_tri")).toEqual({
      swimKm: 0.75,
      bikeKm: 20,
      runKm: 5,
    });
    expect(triathlonLegsFor("sprint triathlon")).toEqual(
      triathlonLegsFor("sprint_tri")
    );
  });

  it("refuses a bare 'triathlon', which names a sport and not a distance", () => {
    expect(triathlonLegsFor("triathlon")).toBeNull();
  });

  it("refuses an unrecognised format rather than guessing one", () => {
    expect(triathlonLegsFor("club champs relay")).toBeNull();
    expect(triathlonLegsFor("")).toBeNull();
  });
});
