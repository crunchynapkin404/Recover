import { describe, expect, it } from "vitest";
import { assertAuthSecret } from "./env-validation";

describe("assertAuthSecret", () => {
  it("throws when BETTER_AUTH_SECRET is missing", () => {
    expect(() => assertAuthSecret({})).toThrow(/BETTER_AUTH_SECRET/);
  });

  it("throws when it is too short to be a real secret", () => {
    expect(() => assertAuthSecret({ BETTER_AUTH_SECRET: "short" })).toThrow(
      /at least 32/
    );
  });

  it("accepts a sufficiently long secret", () => {
    expect(() =>
      assertAuthSecret({ BETTER_AUTH_SECRET: "x".repeat(32) })
    ).not.toThrow();
  });
});
