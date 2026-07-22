import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { ReadinessRings } from "./readiness-rings";

const rings = [
  { label: "Recovery", value: 66, color: "#10b981" },
  { label: "Sleep", value: 81, color: "#3b82f6" },
  { label: "Strain", value: 40, color: "#f59e0b" },
];

describe("ReadinessRings", () => {
  it("renders three nested ring arcs in their colours (track + fill each)", () => {
    const html = renderToString(
      <ReadinessRings readiness={60} readinessColor="#f59e0b" rings={rings} />
    );
    expect(html).toContain("#10b981");
    expect(html).toContain("#3b82f6");
    expect(html).toContain("#f59e0b");
    expect((html.match(/<circle/g) ?? []).length).toBe(6); // 3 tracks + 3 fills
  });

  it("exposes the readiness value to assistive tech", () => {
    const html = renderToString(
      <ReadinessRings readiness={60} readinessColor="#f59e0b" rings={rings} />
    );
    expect(html).toContain("Readiness");
    expect(html).toContain("60");
  });

  it("omits a ring's fill arc while that metric is calibrating", () => {
    const html = renderToString(
      <ReadinessRings
        readiness={60}
        readinessColor="#f59e0b"
        rings={[
          { label: "Recovery", value: 0, color: "#10b981", calibrating: true },
          { label: "Sleep", value: 81, color: "#3b82f6" },
          { label: "Strain", value: 0, color: "#f59e0b", calibrating: true },
        ]}
      />
    );
    // 3 tracks + only Sleep's fill = 4 circles; the emerald fill is absent.
    expect((html.match(/<circle/g) ?? []).length).toBe(4);
    expect(html).not.toContain("#10b981");
    expect(html).toContain("#3b82f6");
  });

  it("shows a dash and an honest label for a calibrating readiness centre", () => {
    const html = renderToString(
      <ReadinessRings
        readiness={0}
        readinessColor="rgba(255,255,255,0.4)"
        readinessCalibrating
        rings={rings}
      />
    );
    expect(html).toContain("—");
    expect(html).toContain("Readiness calibrating");
  });
});
