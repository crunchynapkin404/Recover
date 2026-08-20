import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { Figure } from "@/lib/uncertainty";
import { RaceChip } from "./race-chip";

// @testing-library/react is not a dependency of this repo (see
// tests/backfill-card.test.tsx, tests/journal-form.test.tsx) — RaceChip has
// no interactivity, so renderToString, as the deleted
// race-countdown.test.tsx used for the component this one supersedes, is
// the established pattern.

const RACE = {
  name: "Alpe Sportive",
  date: "2026-09-05",
  priority: "A",
  goalNote: null,
};

describe("RaceChip", () => {
  it("shows the form figure when there is a projection", () => {
    const html = renderToString(
      <RaceChip
        race={RACE}
        daysOut={45}
        pacing={null}
        outlook={Figure.available(
          {
            full: { tsb: 5, band: "green" },
            adherence: { tsb: 1, band: "amber" },
            capped: false,
          },
          "low",
          "Form outlook only: TSB from planned load, not readiness."
        )}
      />
    );
    expect(html).toMatch(/form \+3 ±2/);
  });

  it("marks a projection that stops before race day", () => {
    const html = renderToString(
      <RaceChip
        race={RACE}
        daysOut={45}
        pacing={null}
        outlook={Figure.available(
          {
            full: { tsb: 5, band: "green" },
            adherence: null,
            capped: true,
          },
          "low",
          "Projection ends at plan end, before race day — it is not a race-day figure."
        )}
      />
    );
    expect(html).toMatch(/plan end/);
  });

  it("says what is missing instead of dropping the clause silently", () => {
    const html = renderToString(
      <RaceChip
        race={RACE}
        daysOut={45}
        pacing={null}
        outlook={Figure.missingInput("training-load history")}
      />
    );
    expect(html).toMatch(/training-load history/);
  });
});
