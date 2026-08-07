import { describe, expect, it } from "vitest";
import {
  normalizeSeasonState,
  resolveReentryStage,
  resolveSeasonMode,
} from "./resolve";

describe("season mode resolver", () => {
  it("defaults missing mode to normal", () => {
    expect(resolveSeasonMode(undefined)).toBe("normal");
  });

  it("defaults invalid mode to normal", () => {
    expect(resolveSeasonMode("weird" as never)).toBe("normal");
  });

  it("keeps off_season when valid", () => {
    expect(resolveSeasonMode("off_season")).toBe("off_season");
  });

  it("defaults reentry stage to none", () => {
    expect(resolveReentryStage(undefined)).toBe("none");
  });

  it("normal mode forces reentry none", () => {
    expect(
      normalizeSeasonState({ seasonMode: "normal", reentryStage: "week_1" })
    ).toEqual({ seasonMode: "normal", reentryStage: "none" });
  });
});
