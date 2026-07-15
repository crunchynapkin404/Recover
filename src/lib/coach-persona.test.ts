import { describe, it, expect } from "vitest";
import { buildSystemPrompt, type CoachPersonality } from "@/lib/coach-persona";

describe("coach personality presets (v0.4a)", () => {
  const base = { userName: "Test", todayDate: "2026-01-01" };
  const markers: Record<CoachPersonality, string> = {
    analytical: "Personality: Analytical",
    encouraging: "Personality: Encouraging",
    direct: "Personality: Direct",
  };

  it("applies each preset and keeps safety rules in all of them", () => {
    for (const personality of Object.keys(markers) as CoachPersonality[]) {
      const prompt = buildSystemPrompt({ ...base, personality });
      expect(prompt).toContain(markers[personality]);
      expect(prompt).toContain("NEVER invent numbers");
      expect(prompt).toContain("never overrides the Behavior rules");
    }
  });

  it("defaults to encouraging", () => {
    expect(buildSystemPrompt(base)).toContain("Personality: Encouraging");
  });

  it("includes the memory block when provided, omits when empty", () => {
    const withMemory = buildSystemPrompt({
      ...base,
      memoryBlock: "## What you know about this athlete\n- (goal) sub-3",
    });
    expect(withMemory).toContain("What you know about this athlete");
    expect(buildSystemPrompt({ ...base, memoryBlock: "" })).not.toContain(
      "What you know about this athlete"
    );
  });
});

describe("coach persona", () => {
  it("includes the user name and date in the prompt", () => {
    const prompt = buildSystemPrompt({
      userName: "Bart",
      todayDate: "2026-07-14",
    });
    expect(prompt).toContain("Bart");
    expect(prompt).toContain("2026-07-14");
  });

  it("contains key persona constraints", () => {
    const prompt = buildSystemPrompt({
      userName: "Test",
      todayDate: "2026-01-01",
    });
    // Evidence-based, cites numbers
    expect(prompt).toContain("cite");
    expect(prompt).toContain("NEVER invent numbers");
    // Red band safety: recovery only, no intensity
    expect(prompt).toContain("Red band");
    expect(prompt).toMatch(/Red band.*ONLY recovery/);
    // Medical refusal + escalation
    expect(prompt).toContain("Refuse medical diagnoses");
    expect(prompt).toContain("healthcare professional");
    // Strava exclusion
    expect(prompt).toContain("No Strava data");
  });

  it("prompt snapshot stability", () => {
    const prompt = buildSystemPrompt({
      userName: "Athlete",
      todayDate: "2026-06-01",
    });
    // Key sections exist
    expect(prompt).toMatch(/## Identity/);
    expect(prompt).toMatch(/## Decision Framework/);
    expect(prompt).toMatch(/## Communication Style/);
    expect(prompt).toMatch(/## Recovery Protocols/);
    expect(prompt).toMatch(/## Pattern Recognition/);
    expect(prompt).toMatch(/## Behavior rules/);
  });
});
