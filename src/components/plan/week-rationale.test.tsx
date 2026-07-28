import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { WeekRationale } from "./week-rationale";

describe("WeekRationale", () => {
  it("shows every reason the engine recorded", () => {
    const html = renderToString(
      <WeekRationale
        reasons={[
          "last week was fully missed — restarting at 60% of the skeleton target (244)",
          "3.1h available instead of 6.0h — week load lowered to 244",
        ]}
        targetHours={6}
        plannedHours={4.9}
        shortfall={null}
        raceName={null}
      />
    );
    expect(html).toContain("fully missed");
    expect(html).toContain("3.1h available");
  });

  it("states planned against target", () => {
    const html = renderToString(
      <WeekRationale
        reasons={[]}
        targetHours={11}
        plannedHours={11}
        shortfall={null}
        raceName={null}
      />
    );
    expect(html).toContain("11h planned against an 11h target");
  });

  it("states the shortfall plainly when availability capped the week", () => {
    const html = renderToString(
      <WeekRationale
        reasons={[]}
        targetHours={7}
        plannedHours={7}
        shortfall={{ wantedHours: 11, offeredHours: 7 }}
        raceName="Dolomites"
      />
    );
    expect(html).toContain("Dolomites asks about 11h");
    expect(html).toContain("not race it");
  });

  it("names no event it was not given", () => {
    // The shortfall sentence must still work before a race is entered.
    const html = renderToString(
      <WeekRationale
        reasons={[]}
        targetHours={7}
        plannedHours={7}
        shortfall={{ wantedHours: 11, offeredHours: 7 }}
        raceName={null}
      />
    );
    expect(html).toContain("asks about 11h");
    expect(html).not.toContain("null");
  });

  it("renders nothing when there is nothing to explain", () => {
    const html = renderToString(
      <WeekRationale
        reasons={[]}
        targetHours={null}
        plannedHours={null}
        shortfall={null}
        raceName={null}
      />
    );
    expect(html).toBe("");
  });
});
