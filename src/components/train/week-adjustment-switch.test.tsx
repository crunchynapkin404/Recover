import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { WeekAdjustmentSwitch } from "./week-adjustment-switch";

describe("WeekAdjustmentSwitch", () => {
  it("renders all week adjustment actions", () => {
    const html = renderToString(
      <WeekAdjustmentSwitch weekNumber={4} action={async () => {}} />
    );
    expect(html).toContain("Ease week");
    expect(html).toContain("Deload week");
    expect(html).toContain("Boost week");
    expect(html).toContain("Skip week");
    expect(html).toContain('title="Ease week (-30%)"');
    expect(html).toContain('title="Deload week (-50%)"');
    expect(html).toContain('title="Boost week (+10%)"');
    expect(html).toContain('title="Skip week (set to 0)"');
    expect(html).toContain("Ease -30%");
    expect(html).toContain("Deload -50%");
    expect(html).toContain("Boost +10%");
    expect(html).toContain("Skip 0");
  });

  it("posts the open skeleton week with each action", () => {
    const html = renderToString(
      <WeekAdjustmentSwitch weekNumber={4} action={async () => {}} />
    );
    expect(html.match(/name="weekNumber" value="4"/g) ?? []).toHaveLength(4);
    expect(html).toContain('name="weekAction" value="reduce_load"');
    expect(html).toContain('name="weekAction" value="deload_week"');
    expect(html).toContain('name="weekAction" value="increase_load"');
    expect(html).toContain('name="weekAction" value="skip_week"');
  });
});
