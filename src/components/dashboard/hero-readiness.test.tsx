import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { HeroReadiness } from "./hero-readiness";

const base = {
  readiness: 72,
  band: "green" as const,
  recoveryScore: 65,
  strainFraction: 40,
  sleepScore: 88,
  loadCalibrating: false,
  loadComputed: false,
};

describe("HeroReadiness", () => {
  it("wraps the ring in a bounded hero card", () => {
    const html = renderToString(<HeroReadiness {...base} />);
    expect(html).toContain("rounded-[2rem]");
    expect(html).toContain("glass-no-hover");
  });

  it("renders a single Readiness ring plus the Recovery/Sleep/Strain stat row", () => {
    const html = renderToString(<HeroReadiness {...base} />);
    expect(html).toContain("Readiness");
    expect(html).toContain("Recovery");
    expect(html).toContain("Sleep");
    expect(html).toContain("Strain");
    expect(html).toContain("65%");
    expect(html).toContain("88");
    expect(html).toContain("40%");
  });

  it("shows a dash for recovery and strain while load is calibrating", () => {
    const html = renderToString(
      <HeroReadiness
        {...base}
        loadCalibrating
        strainFraction={0}
        recoveryScore={0}
        sleepScore={null}
      />
    );
    expect(html).not.toContain("0%");
    // Recovery, Sleep, and Strain each fall back to an em-dash — no other
    // em-dash appears in the component, so the count pins all three.
    expect(html.match(/—/g)?.length).toBe(3);
  });

  it("shows a dash for sleep when no sleep score exists", () => {
    const html = renderToString(<HeroReadiness {...base} sleepScore={null} />);
    expect(html).toContain("—");
  });

  it("shows the computed-load caption only once loaded and not calibrating", () => {
    const html = renderToString(
      <HeroReadiness {...base} loadComputed loadCalibrating={false} />
    );
    expect(html).toContain("Load computed from your sessions");
  });

  it("hides the computed-load caption while calibrating even if loadComputed is true", () => {
    const html = renderToString(
      <HeroReadiness {...base} loadComputed loadCalibrating />
    );
    expect(html).not.toContain("Load computed from your sessions");
  });

  it("shows no status line while calibrating", () => {
    const html = renderToString(<HeroReadiness {...base} band="calibrating" />);
    expect(html).not.toContain("Ready for intensity");
    expect(html).not.toContain("Consider easy work");
    expect(html).not.toContain("Prioritize rest");
  });

  it("shows the amber status line for an amber band", () => {
    const html = renderToString(<HeroReadiness {...base} band="amber" />);
    expect(html).toContain("Moderate recovery");
  });

  it("shows the red status line for a red band", () => {
    const html = renderToString(<HeroReadiness {...base} band="red" />);
    expect(html).toContain("Low recovery");
  });
});
