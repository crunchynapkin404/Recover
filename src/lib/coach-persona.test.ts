import { describe, it, expect } from "vitest";
import { buildSystemPrompt } from "@/lib/coach-persona";

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
    // Red band safety
    expect(prompt).toContain("Red");
    expect(prompt).toContain("prescribe ONLY recovery activities");
    // Medical refusal
    expect(prompt).toContain("healthcare professional");
    // Strava exclusion
    expect(prompt).toContain("Strava");
    // Data-driven mandate
    expect(prompt).toContain("NEVER invent numbers");
  });

  it("prompt snapshot stability", () => {
    const prompt = buildSystemPrompt({
      userName: "Athlete",
      todayDate: "2026-06-01",
    });
    // Key sections exist
    expect(prompt).toMatch(/## Identity/);
    expect(prompt).toMatch(/## Behavior rules/);
    expect(prompt).toMatch(/## Decision Framework/);
    expect(prompt).toMatch(/## Communication Style/);
    expect(prompt).toMatch(/## Recovery Protocols/);
  });
});
