import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { DayActions } from "./day-actions";

describe("DayActions", () => {
  it("renders nothing for a day without a workout", () => {
    expect(
      renderToString(
        <DayActions
          day={{ date: "2026-08-25", hasWorkout: false }}
          otherDays={[]}
        />
      )
    ).toBe("");
  });

  it("offers move/swap/skip for a workout day", () => {
    const html = renderToString(
      <DayActions
        day={{ date: "2026-08-25", hasWorkout: true }}
        otherDays={[
          { date: "2026-08-26", hasWorkout: false, isRace: false },
          { date: "2026-08-30", hasWorkout: false, isRace: true },
        ]}
      />
    );
    expect(html.toLowerCase()).toContain("move");
    // race days are never offered as targets
    expect(html).not.toContain("2026-08-30");
  });

  it("includes the non-race target date as a move option", () => {
    const html = renderToString(
      <DayActions
        day={{ date: "2026-08-25", hasWorkout: true }}
        otherDays={[
          { date: "2026-08-26", hasWorkout: false, isRace: false },
          { date: "2026-08-30", hasWorkout: false, isRace: true },
        ]}
      />
    );
    expect(html).toContain("2026-08-26");
  });
});
