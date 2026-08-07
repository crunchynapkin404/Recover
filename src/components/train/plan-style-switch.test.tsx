import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { PlanStyleSwitch } from "./plan-style-switch";

describe("PlanStyleSwitch", () => {
  it("renders both style options", () => {
    const html = renderToString(
      <PlanStyleSwitch effectiveStyle="balanced" action={async () => {}} />
    );
    expect(html).toContain("Balanced");
    expect(html).toContain("Block-lite");
  });

  it("marks the active style and disables only that option", () => {
    const html = renderToString(
      <PlanStyleSwitch effectiveStyle="block_lite" action={async () => {}} />
    );
    expect(html).toContain('name="style" value="balanced"');
    expect(html).toContain('name="style" value="block_lite"');
    expect(html.match(/disabled=""/g) ?? []).toHaveLength(1);
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('aria-pressed="false"');
  });
});
