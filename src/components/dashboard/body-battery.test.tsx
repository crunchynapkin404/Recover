import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { Figure } from "@/lib/uncertainty";
import { BodyBatteryCurve } from "./body-battery";

/**
 * v0.9.0 — the battery card previously drew a hardcoded SVG path that no
 * caller ever overrode, so every athlete saw the same fictional day. These
 * tests pin the contract: no data means no curve.
 */
describe("body battery card", () => {
  it("renders a typed calibrating reason instead of a placeholder curve", () => {
    const html = renderToString(
      <BodyBatteryCurve
        current={Figure.calibrating(4, 14, "days")}
        points={[]}
        tags={[]}
        checkpoints={[]}
      />
    );
    expect(html).toContain("Calibrating — day 4 of 14 days");
    expect(html).not.toContain("<path");
  });

  it("never contains the old hardcoded placeholder path", () => {
    const html = renderToString(
      <BodyBatteryCurve
        current={Figure.available(70, "high")}
        points={[
          { minutes: 0, charge: 90 },
          { minutes: 720, charge: 80 },
          { minutes: 1440, charge: 70 },
        ]}
        tags={[]}
        checkpoints={[]}
      />
    );
    expect(html).not.toContain("M0 40 Q50 30 80 45");
  });

  it("labels itself an estimate rather than a measurement", () => {
    const html = renderToString(
      <BodyBatteryCurve
        current={Figure.available(70, "high")}
        points={[{ minutes: 0, charge: 70 }]}
        tags={[]}
        checkpoints={[]}
      />
    );
    expect(html).toContain("Estimated Energy");
  });

  it("plots the real points it is given", () => {
    const html = renderToString(
      <BodyBatteryCurve
        current={Figure.available(50, "high")}
        points={[
          { minutes: 0, charge: 100 },
          { minutes: 720, charge: 50 },
        ]}
        tags={["rest day"]}
        checkpoints={[]}
      />
    );
    // 0min → x=0, charge 100 → y=0; 720min → x=200, charge 50 → y=90.
    expect(html).toContain("M0.0 0.0 L200.0 90.0");
  });

  it("renders day tags and checkpoints", () => {
    const html = renderToString(
      <BodyBatteryCurve
        current={Figure.available(45, "high")}
        points={[{ minutes: 0, charge: 45 }]}
        tags={["hard day", "sleep debt"]}
        checkpoints={[
          { label: "Morning", minutes: 420, charge: 45 },
          { label: "Midday", minutes: 780, charge: 30 },
          { label: "Evening", minutes: 1140, charge: 20 },
        ]}
      />
    );

    expect(html).toContain("hard day");
    expect(html).toContain("Morning");
    expect(html).toContain("30<!-- -->%");
  });
});
