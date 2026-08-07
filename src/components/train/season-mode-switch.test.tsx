import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { SeasonModeSwitch } from "./season-mode-switch";

describe("SeasonModeSwitch", () => {
  it("renders both season mode options", () => {
    const html = renderToString(
      <SeasonModeSwitch
        effectiveSeasonMode="normal"
        reentryStage="none"
        action={async () => {}}
      />
    );
    expect(html).toContain("Normal");
    expect(html).toContain("Off-season");
  });

  it("shows re-entry starter only for off-season with no active re-entry", () => {
    const html = renderToString(
      <SeasonModeSwitch
        effectiveSeasonMode="off_season"
        reentryStage="none"
        action={async () => {}}
      />
    );
    expect(html).toContain("Start re-entry");
    expect(html).toContain('name="seasonAction" value="begin_reentry"');
  });

  it("shows active re-entry label and hides duplicate starter", () => {
    const html = renderToString(
      <SeasonModeSwitch
        effectiveSeasonMode="off_season"
        reentryStage="week_1"
        action={async () => {}}
      />
    );
    expect(html).toContain("Re-entry week 1");
    expect(html).not.toContain("Start re-entry");
  });
});
