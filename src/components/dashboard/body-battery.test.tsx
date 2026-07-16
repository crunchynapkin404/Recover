import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { BodyBatteryCurve } from "./body-battery";

/**
 * v0.9.0 — the battery card previously drew a hardcoded SVG path that no
 * caller ever overrode, so every athlete saw the same fictional day. These
 * tests pin the contract: no data means no curve.
 */
describe("body battery card", () => {
  it("renders an empty state instead of a placeholder curve when null", () => {
    const html = renderToString(
      <BodyBatteryCurve current={null} points={[]} />
    );
    expect(html).toContain("Not enough data");
    expect(html).not.toContain("<path");
  });

  it("never contains the old hardcoded placeholder path", () => {
    const html = renderToString(
      <BodyBatteryCurve
        current={70}
        points={[
          { minutes: 0, charge: 90 },
          { minutes: 720, charge: 80 },
          { minutes: 1440, charge: 70 },
        ]}
      />
    );
    expect(html).not.toContain("M0 40 Q50 30 80 45");
  });

  it("labels itself an estimate rather than a measurement", () => {
    const html = renderToString(
      <BodyBatteryCurve current={70} points={[{ minutes: 0, charge: 70 }]} />
    );
    expect(html).toContain("Estimated Energy");
  });

  it("plots the real points it is given", () => {
    const html = renderToString(
      <BodyBatteryCurve
        current={50}
        points={[
          { minutes: 0, charge: 100 },
          { minutes: 720, charge: 50 },
        ]}
      />
    );
    // 0min → x=0, charge 100 → y=0; 720min → x=200, charge 50 → y=90.
    expect(html).toContain("M0.0 0.0 L200.0 90.0");
  });
});
