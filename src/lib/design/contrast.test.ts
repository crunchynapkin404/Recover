import { describe, it, expect } from "vitest";
import { hexToRgb, relativeLuminance, contrastRatio } from "./contrast";

describe("hexToRgb", () => {
  it("parses six-digit hex", () => {
    expect(hexToRgb("#0a0a0a")).toEqual([10, 10, 10]);
    expect(hexToRgb("#FFFFFF")).toEqual([255, 255, 255]);
  });

  it("rejects anything that is not a six-digit hex", () => {
    expect(() => hexToRgb("rgba(255,255,255,0.4)")).toThrow();
    expect(() => hexToRgb("#fff")).toThrow();
  });
});

describe("relativeLuminance", () => {
  it("is 0 for black and 1 for white", () => {
    expect(relativeLuminance("#000000")).toBeCloseTo(0, 5);
    expect(relativeLuminance("#ffffff")).toBeCloseTo(1, 5);
  });
});

describe("contrastRatio", () => {
  it("is 21:1 for black on white, in either order", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 2);
    expect(contrastRatio("#ffffff", "#000000")).toBeCloseTo(21, 2);
  });

  it("is 1:1 for a colour against itself", () => {
    expect(contrastRatio("#10b981", "#10b981")).toBeCloseTo(1, 5);
  });

  // Hand-checked reference: #767676 on #ffffff is the canonical WCAG AA
  // boundary colour for normal text.
  it("puts the canonical AA boundary grey at 4.54:1 on white", () => {
    expect(contrastRatio("#767676", "#ffffff")).toBeCloseTo(4.54, 1);
  });
});
