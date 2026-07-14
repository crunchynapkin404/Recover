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
    expect(prompt).toContain("NEVER prescribe intensity");
    // Medical refusal
    expect(prompt).toContain("not a doctor");
    // Strava exclusion
    expect(prompt).toContain("Strava");
    // Tool usage mandate
    expect(prompt).toContain("Always use tools");
  });

  it("prompt snapshot stability", () => {
    const prompt = buildSystemPrompt({
      userName: "Athlete",
      todayDate: "2026-06-01",
    });
    // Key sections exist
    expect(prompt).toMatch(/## Your role/);
    expect(prompt).toMatch(/## Behavior rules/);
    expect(prompt).toMatch(/## Available tools/);
    expect(prompt).toMatch(/## Scope/);
    expect(prompt).toMatch(/## Out of scope/);
  });
});
