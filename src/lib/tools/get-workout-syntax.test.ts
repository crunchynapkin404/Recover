import { describe, expect, it } from "vitest";
import { getWorkoutSyntax } from "./get-workout-syntax";
import type { ToolContext } from "./registry";

const ctx: ToolContext = {
  userId: "u1",
  db: {} as unknown as ToolContext["db"],
};

describe("get_workout_syntax", () => {
  it("returns a non-empty syntax string with no HTTP or connection needed", async () => {
    const out = (await getWorkoutSyntax.execute({}, ctx)) as {
      syntax: string;
    };
    expect(typeof out.syntax).toBe("string");
    expect(out.syntax.length).toBeGreaterThan(0);
    expect(out.syntax).toContain("Warmup");
  });

  it("takes no parameters", () => {
    expect(getWorkoutSyntax.parameters.safeParse({}).success).toBe(true);
  });

  it("has no explicit scope (defaults to read)", () => {
    expect(getWorkoutSyntax.scope).toBeUndefined();
  });
});
