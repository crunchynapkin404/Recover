import { describe, expect, it } from "vitest";
import { axeGateEnabled } from "../scripts/lib/axe-gate";

describe("axeGateEnabled", () => {
  it("is on by default, so a local run still fails on a confirmed defect", () => {
    expect(axeGateEnabled(["node", "verify-surfaces.ts", "slice"])).toBe(true);
  });

  it("is off when --no-axe-gate is passed", () => {
    expect(
      axeGateEnabled(["node", "verify-surfaces.ts", "slice", "--no-axe-gate"])
    ).toBe(false);
  });

  it("is unaffected by the surface filters", () => {
    expect(
      axeGateEnabled(["node", "verify-surfaces.ts", "slice", "--only=today"])
    ).toBe(true);
  });

  it("composes with a filter", () => {
    expect(
      axeGateEnabled([
        "node",
        "verify-surfaces.ts",
        "slice",
        "--except=today",
        "--no-axe-gate",
      ])
    ).toBe(false);
  });
});
