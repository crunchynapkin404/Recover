import { describe, expect, it } from "vitest";
import { Figure } from "./uncertainty";
import type { Figure as FigureT } from "./uncertainty";

describe("Figure", () => {
  it("available() carries a value and confidence", () => {
    const f = Figure.available(42, "high");
    expect(f.available).toBe(true);
    if (f.available) {
      expect(f.value).toBe(42);
      expect(f.confidence).toBe("high");
      expect(f.why).toBeUndefined();
    }
  });

  it("available() carries an optional why", () => {
    const f = Figure.available(7, "medium", "estimated from FTP");
    expect(f.available && f.why).toBe("estimated from FTP");
  });

  it("calibrating() carries have/need/unit and no value", () => {
    const f: FigureT<number> = Figure.calibrating(4, 14, "days");
    expect(f.available).toBe(false);
    if (!f.available) {
      expect(f.kind).toBe("calibrating");
      expect(f.have).toBe(4);
      expect(f.need).toBe(14);
      expect(f.unit).toBe("days");
    }
  });

  it("missingInput() carries needs and an optional fix link", () => {
    const f: FigureT<number> = Figure.missingInput("FTP", {
      label: "Set FTP",
      href: "/settings",
    });
    expect(f.available).toBe(false);
    if (!f.available) {
      expect(f.kind).toBe("missing_input");
      expect(f.needs).toBe("FTP");
      expect(f.fix).toEqual({ label: "Set FTP", href: "/settings" });
    }
  });

  it("missingInput() allows no fix link", () => {
    const f: FigureT<number> = Figure.missingInput("a race date");
    expect(!f.available && f.fix).toBeUndefined();
  });

  it("notApplicable() carries a reason", () => {
    const f: FigureT<number> = Figure.notApplicable("no race scheduled");
    expect(f.available).toBe(false);
    if (!f.available) {
      expect(f.kind).toBe("not_applicable");
      expect(f.why).toBe("no race scheduled");
    }
  });
});
