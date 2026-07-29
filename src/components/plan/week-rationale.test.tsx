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
        source={null}
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
        source={null}
      />
    );
    expect(html).toContain("11h planned against an 11h target");
  });

  it("uses 'a' rather than 'an' for a target that doesn't start with a vowel sound", () => {
    // Finding 3: article()'s "a" branch had zero coverage — every existing
    // test used 11 (or another "an" case), so `article()` could be hardcoded
    // to always return "an" and still pass all of them. Correction: this
    // test (6), the existing "an" test (11) and the "an" test below (18) do
    // NOT cover all of article()'s branches between them — none of 6, 11 or
    // 18 starts with "8", so `startsWith("8")`'s true case went untested
    // until the dedicated 8h test further below was added. Don't read these
    // three as exhaustive.
    const html = renderToString(
      <WeekRationale
        reasons={[]}
        targetHours={6}
        plannedHours={6}
        shortfall={null}
        raceName={null}
        source={null}
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
        source={null}
      />
    );
    expect(html).toContain("18h planned against an 18h target");
  });

  it("uses 'an' for an 8h target", () => {
    // Coverage gap closed: the "a" test above uses 6h and the "an" tests use
    // 11h and 18h — none of those starts with "8", so `startsWith("8")`'s
    // true branch (an 8-series target such as 8h, or 80-89h) was exercised
    // by no test in this file even though article(8) has always correctly
    // returned "an". Pinned directly here, in its own block, rather than
    // repurposing an existing fixture.
    const html = renderToString(
      <WeekRationale
        reasons={[]}
        targetHours={8}
        plannedHours={8}
        shortfall={null}
        raceName={null}
        source={null}
      />
    );
    expect(html).toContain("8h planned against an 8h target");
  });

  it("attributes the shortfall to the race only when source is 'race'", () => {
    const html = renderToString(
      <WeekRationale
        reasons={[]}
        targetHours={7}
        plannedHours={7}
        shortfall={{ wantedHours: 11, offeredHours: 7 }}
        raceName="Dolomites"
        source="race"
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
        source="race"
      />
    );
    expect(html).toContain("Dolomites asks about 8h");
    expect(html).toContain("no time at all");
    expect(html).not.toContain("enough to ride it");
  });

  // Final-review Finding 3: shortfall.wantedHours is the post-floor /
  // post-ceiling / post-fallback target, NOT demand.weeklyHours. Before this
  // fix, every source printed "${raceName ?? "Your event"} asks about Xh a
  // week" regardless of where X actually came from — misattributing the
  // athlete's own ceiling, floor, or plan fallback to the race. Each source
  // now gets its own true sentence, and only "race" may name the event.
  describe("attributes the shortfall correctly per source", () => {
    it("source 'race': names the race", () => {
      const html = renderToString(
        <WeekRationale
          reasons={[]}
          targetHours={7}
          plannedHours={7}
          shortfall={{ wantedHours: 11, offeredHours: 7 }}
          raceName="Dolomites"
          source="race"
        />
      );
      expect(html).toContain("Dolomites asks about 11h a week");
    });

    it("source 'ceiling': attributes the number to measured capacity, not the race", () => {
      // The exact contradiction Finding 3 found live: a low-peak athlete's
      // ceiling-bound number must not be printed as what the race "asks",
      // since EventReadiness shows the race's real (much larger) demand
      // figure one panel below.
      const html = renderToString(
        <WeekRationale
          reasons={[]}
          targetHours={2}
          plannedHours={2}
          shortfall={{ wantedHours: 3.1, offeredHours: 2 }}
          raceName="Dolomites"
          source="ceiling"
        />
      );
      expect(html).toContain("training capacity");
      expect(html).toContain("3.1h a week");
      expect(html).not.toContain("Dolomites asks");
    });

    it("source 'floor': attributes the number to the maintenance floor, not the race", () => {
      const html = renderToString(
        <WeekRationale
          reasons={[]}
          targetHours={3}
          plannedHours={3}
          shortfall={{ wantedHours: 5.3, offeredHours: 3 }}
          raceName="Criterium"
          source="floor"
        />
      );
      expect(html).toContain("maintenance");
      expect(html).toContain("5.3h a week");
      expect(html).not.toContain("Criterium asks");
    });

    it("source 'fallback': names no event — the pre-existing-race-with-no-distance case", () => {
      // The common case today: every pre-existing race has distance_km
      // NULL, so demand is null and source is "fallback" — wantedHours is
      // the athlete's own typed hoursPerWeek. The race had no part in it.
      const html = renderToString(
        <WeekRationale
          reasons={[]}
          targetHours={3}
          plannedHours={3}
          shortfall={{ wantedHours: 8, offeredHours: 3 }}
          raceName="Some Upcoming Race"
          source="fallback"
        />
      );
      expect(html).toContain("Your plan calls for about 8h a week");
      expect(html).not.toContain("Some Upcoming Race asks");
    });

    it("source 'fallback' with no race entered at all: still true, still no event named", () => {
      const html = renderToString(
        <WeekRationale
          reasons={[]}
          targetHours={7}
          plannedHours={7}
          shortfall={{ wantedHours: 8, offeredHours: 7 }}
          raceName={null}
          source="fallback"
        />
      );
      expect(html).toContain("Your plan calls for about 8h a week");
      expect(html).not.toContain("asks about");
      expect(html).not.toContain("null");
    });
  });

  it("renders nothing when there is nothing to explain", () => {
    const html = renderToString(
      <WeekRationale
        reasons={[]}
        targetHours={null}
        plannedHours={null}
        shortfall={null}
        raceName={null}
        source={null}
      />
    );
    expect(html).toBe("");
  });
});
