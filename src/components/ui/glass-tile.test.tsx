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
});
