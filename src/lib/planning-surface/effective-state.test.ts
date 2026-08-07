import { describe, expect, it } from "vitest";
import { resolvePlanningSurfaceState } from "./effective-state";

describe("resolvePlanningSurfaceState", () => {
  it("falls back to balanced/normal/none when constraints are missing", () => {
    expect(resolvePlanningSurfaceState(null)).toEqual({
      effectiveStyle: "balanced",
      effectiveSeasonMode: "normal",
      reentryStage: "none",
    });
  });

  it("forces reentryStage=none when season mode is normal", () => {
    expect(
      resolvePlanningSurfaceState({
        planStyle: "block_lite",
        seasonMode: "normal",
        reentryStage: "week_1",
      })
    ).toEqual({
      effectiveStyle: "block_lite",
      effectiveSeasonMode: "normal",
      reentryStage: "none",
    });
  });

  it("keeps off-season reentry stage when valid", () => {
    expect(
      resolvePlanningSurfaceState({
        planStyle: "block_lite",
        seasonMode: "off_season",
        reentryStage: "week_2",
      })
    ).toEqual({
      effectiveStyle: "block_lite",
      effectiveSeasonMode: "off_season",
      reentryStage: "week_2",
    });
  });
});
