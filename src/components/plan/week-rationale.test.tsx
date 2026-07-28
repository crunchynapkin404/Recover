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

  it("uses 'a' rather than 'an' for a target that doesn't start with a vowel sound", () => {
    // Finding 3: article()'s "a" branch had zero coverage — every existing
    // test used 11 (or another "an" case), so `article()` could be hardcoded
    // to always return "an" and still pass all of them.
    const html = renderToString(
      <WeekRationale
        reasons={[]}
        targetHours={6}
        plannedHours={6}
        shortfall={null}
        raceName={null}
      />
    );
    expect(html).toContain("6h planned against a 6h target");
  });

  it("uses 'an' for an 18h target", () => {
    // Finding 4: article() only special-cased strings starting with "8" or
    // "11", so 18 ("eighteen") fell through to "a" even though it starts
    // with a vowel sound. 15-19h/week is the realistic stage-race band this
    // component exists to display (see race/demand.test.ts), so this is not
    // a contrived edge case.
    const html = renderToString(
      <WeekRationale
        reasons={[]}
        targetHours={18}
        plannedHours={18}
        shortfall={null}
        raceName={null}
      />
    );
    expect(html).toContain("18h planned against an 18h target");
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

  it("does not claim a zero-hour week is enough to ride when the calendar offered nothing", () => {
    // Finding 5: "enough to ride it, not race it" is false at 0h — there was
    // no time offered at all, not merely "not enough to race on".
    const html = renderToString(
      <WeekRationale
        reasons={[]}
        targetHours={0}
        plannedHours={0}
        shortfall={{ wantedHours: 8, offeredHours: 0 }}
        raceName="Dolomites"
      />
    );
    expect(html).toContain("Dolomites asks about 8h");
    expect(html).toContain("no time at all");
    expect(html).not.toContain("enough to ride it");
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
