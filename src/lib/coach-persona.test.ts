import { describe, it, expect } from "vitest";
import {
  buildSystemPrompt,
  languageDirective,
  type CoachPersonality,
  SUPPORTED_COACH_LANGUAGES,
} from "@/lib/coach-persona";

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

describe("coach language setting", () => {
  const base = { userName: "Test", todayDate: "2026-01-01" };

  it("defaults to the auto (match-the-athlete) rule when language is unset", () => {
    const prompt = buildSystemPrompt(base);
    expect(prompt).toContain(
      "You MUST reply in the SAME language the athlete writes in"
    );
  });

  it("uses the auto rule when language is explicitly 'auto'", () => {
    const prompt = buildSystemPrompt({ ...base, language: "auto" });
    expect(prompt).toContain(
      "You MUST reply in the SAME language the athlete writes in"
    );
  });

  it("pins the reply language when a specific language is set", () => {
    const prompt = buildSystemPrompt({ ...base, language: "nl" });
    expect(prompt).toContain("You MUST reply in Dutch");
    expect(prompt).toContain(
      "regardless of what language the athlete writes in"
    );
    expect(prompt).not.toContain(
      "You MUST reply in the SAME language the athlete writes in"
    );
  });

  it("falls back to auto for an unrecognized language code", () => {
    const prompt = buildSystemPrompt({ ...base, language: "xx-bogus" });
    expect(prompt).toContain(
      "You MUST reply in the SAME language the athlete writes in"
    );
  });

  it("exposes a code for every language it claims to support, English and Dutch included", () => {
    const codes = SUPPORTED_COACH_LANGUAGES.map((l) => l.code);
    expect(codes).toContain("auto");
    expect(codes).toContain("en");
    expect(codes).toContain("nl");
    // No duplicate codes.
    expect(new Set(codes).size).toBe(codes.length);
  });
});

/**
 * The system-prompt rule alone proved insufficient on the proactive surfaces.
 * Observed live 2026-07-27: with coach_language='nl' and the Dutch rule sitting
 * as line 1 of a 6.5k-char system prompt, claude-haiku-4-5 still returned an
 * ENGLISH morning brief that opened "**Proactive Check-In — 2026-07-27**" —
 * echoing the phrasing of its English instruction ("Write this morning's
 * proactive check-in"). The identical setup produced Dutch the day before.
 *
 * Chat never shows this: the athlete's own Dutch message reinforces the rule.
 * The five no-input surfaces have nothing but an English instruction as the
 * last thing the model reads, so the directive has to travel WITH it.
 */
describe("languageDirective (proactive-surface reinforcement)", () => {
  it("appends a target-language directive when a language is pinned", () => {
    const out = languageDirective("Write this morning's check-in.", "nl");
    expect(out).toContain("Write this morning's check-in.");
    expect(out).toContain("Dutch");
  });

  it("names the right language for other pinned codes", () => {
    expect(languageDirective("x", "de")).toContain("German");
    expect(languageDirective("x", "fr")).toContain("French");
  });

  it("leaves the instruction untouched on auto", () => {
    expect(languageDirective("Write it.", "auto")).toBe("Write it.");
  });

  it("leaves the instruction untouched when language is unset", () => {
    expect(languageDirective("Write it.", undefined)).toBe("Write it.");
  });

  it("leaves the instruction untouched for an unrecognized code", () => {
    expect(languageDirective("Write it.", "xx-bogus")).toBe("Write it.");
  });
});
