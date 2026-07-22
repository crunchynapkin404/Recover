import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { GlassTile } from "./glass-tile";

describe("GlassTile", () => {
  it("renders the label and value inside a glass tile", () => {
    const html = renderToString(<GlassTile label="Recovery" value="65%" />);
    expect(html).toContain("Recovery");
    expect(html).toContain("65%");
    expect(html).toContain("label-micro");
    expect(html).toContain("glass");
    expect(html).toContain("rounded-2xl");
  });

  it("renders an optional child slot after the value", () => {
    const html = renderToString(
      <GlassTile label="Sleep" value="88">
        <div data-slot="bar" />
      </GlassTile>
    );
    expect(html).toContain('data-slot="bar"');
  });

  it("merges a passed className onto the container", () => {
    const html = renderToString(
      <GlassTile label="Strain" value="—" className="text-center" />
    );
    expect(html).toContain("text-center");
  });

  it("renders a progress bar clamped to 0–100 with the given color", () => {
    const html = renderToString(
      <GlassTile
        label="Recovery"
        value="65%"
        bar={{ value: 65, color: "#f59e0b" }}
      />
    );
    expect(html).toContain("width:65%");
    expect(html).toContain("#f59e0b");
  });

  it("clamps an over-100 bar value to 100%", () => {
    const html = renderToString(
      <GlassTile label="X" value="120" bar={{ value: 120 }} />
    );
    expect(html).toContain("width:100%");
  });

  it("renders no bar when bar is omitted", () => {
    const html = renderToString(<GlassTile label="X" value="—" />);
    expect(html).not.toContain("width:");
  });
});
