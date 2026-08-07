import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { WeekAdjustmentSwitch } from "./week-adjustment-switch";

describe("WeekAdjustmentSwitch", () => {
  it("renders all week adjustment actions", () => {
    const html = renderToString(
      <WeekAdjustmentSwitch weekNumber={4} action={async () => {}} />
    );
    expect(html).toContain("Ease week");
    expect(html).toContain("Boost week");
    expect(html).toContain("Skip week");
  });

  it("posts the open skeleton week with each action", () => {
    const html = renderToString(
      <WeekAdjustmentSwitch weekNumber={4} action={async () => {}} />
    );
    expect(html.match(/name="weekNumber" value="4"/g) ?? []).toHaveLength(3);
    expect(html).toContain('name="weekAction" value="reduce_load"');
    expect(html).toContain('name="weekAction" value="increase_load"');
    expect(html).toContain('name="weekAction" value="skip_week"');
  });
});
