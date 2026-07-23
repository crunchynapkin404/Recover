import { describe, expect, it } from "vitest";
import { buildDebriefPayload, buildMorningPayload } from "@/lib/push";

describe("buildMorningPayload", () => {
  it("formats a full amber morning", () => {
    const p = buildMorningPayload({
      readiness: 66,
      band: "amber",
      hrvMs: 63.8,
      restingHr: 48.2,
      sleepSecs: 6.9 * 3600,
    });
    expect(p.title).toBe("Readiness 66 · Amber");
    expect(p.body).toContain("HRV 64 ms");
    expect(p.body).toContain("RHR 48");
    expect(p.body).toContain("Sleep 6.9 h");
    expect(p.body).toContain("Moderate");
    expect(p.tag).toBe("morning-readiness");
    expect(p.url).toBe("/?sheet=checkin");
  });

  it("band lines differ", () => {
    const base = {
      readiness: 80,
      hrvMs: 70,
      restingHr: 45,
      sleepSecs: 8 * 3600,
    };
    expect(buildMorningPayload({ ...base, band: "green" }).body).toContain(
      "Green light"
    );
    expect(
      buildMorningPayload({ ...base, readiness: 20, band: "red" }).body
    ).toContain("Recovery day");
  });

  it("omits missing metrics", () => {
    const p = buildMorningPayload({
      readiness: 50,
      band: "amber",
      hrvMs: null,
      restingHr: null,
      sleepSecs: null,
    });
    expect(p.body).not.toContain("HRV");
    expect(p.body).not.toContain("Sleep");
  });

  it("appends the insight teaser on its own line, clamped to 120 chars", () => {
    const base = {
      readiness: 72,
      band: "green" as const,
      hrvMs: 70,
      restingHr: 45,
      sleepSecs: 8 * 3600,
    };
    const short = buildMorningPayload({
      ...base,
      insightTeaser: "Go long today.",
    });
    expect(short.body.endsWith("\nGo long today.")).toBe(true);

    const long = buildMorningPayload({
      ...base,
      insightTeaser: "x".repeat(200),
    });
    const teaserLine = long.body.split("\n").pop()!;
    expect(teaserLine.length).toBe(120);
    expect(teaserLine.endsWith("…")).toBe(true);

    const none = buildMorningPayload({ ...base, insightTeaser: null });
    expect(none.body).not.toContain("\n");
  });
});

describe("push deep-links", () => {
  it("sends the morning push into the check-in sheet, not the dashboard", () => {
    const p = buildMorningPayload({
      readiness: 66,
      band: "amber",
      hrvMs: 64,
      restingHr: 47,
      sleepSecs: 25_920,
    });
    expect(p.url).toBe("/?sheet=checkin");
  });

  it("sends the debrief push into that ride's own sheet", () => {
    const p = buildDebriefPayload({
      activityId: "abc-123",
      activityName: "Morning Intervals",
      durationS: 4500,
      load: 78,
    });
    expect(p.url).toBe("/?sheet=debrief&activity=abc-123");
    expect(p.body).toContain("Morning Intervals");
    expect(p.body).toContain("1:15");
    expect(p.body).toContain("load 78");
  });

  it("omits metrics the ride doesn't have rather than printing zeroes", () => {
    const p = buildDebriefPayload({
      activityId: "x",
      activityName: "Gym",
      durationS: null,
      load: null,
    });
    expect(p.body).toBe("Gym. How did it feel?");
    expect(p.body).not.toContain("load");
  });
});
