import { describe, it, expect } from "vitest";
import { readPrefixedThemeTokens } from "./tokens";

const CSS = `@theme inline {
  --color-background: var(--background);
  --text-label: 0.75rem; /* 12 */
  --duration-motion: 200ms;
  --ease-settle: cubic-bezier(0.21, 1.02, 0.49, 1);
}

:root {
  --duration-decoy: 999ms;
}
`;

describe("readPrefixedThemeTokens", () => {
  it("reads declarations with the given prefix out of @theme inline", () => {
    expect(readPrefixedThemeTokens(CSS, "--duration-")).toEqual({
      "--duration-motion": "200ms",
    });
  });

  it("keeps the raw value, including commas and parentheses", () => {
    expect(readPrefixedThemeTokens(CSS, "--ease-")).toEqual({
      "--ease-settle": "cubic-bezier(0.21, 1.02, 0.49, 1)",
    });
  });

  it("ignores declarations outside the @theme block", () => {
    // --duration-decoy lives in :root, not @theme, and must not be read:
    // a token that is not in @theme generates no Tailwind utility, so
    // counting it would let a non-token masquerade as part of the scale.
    const found = readPrefixedThemeTokens(CSS, "--duration-");
    expect(found["--duration-decoy"]).toBeUndefined();
  });

  it("returns an empty map for a prefix with no declarations", () => {
    expect(readPrefixedThemeTokens(CSS, "--nothing-")).toEqual({});
  });

  it("throws when there is no @theme inline block", () => {
    expect(() => readPrefixedThemeTokens(":root { --a: 1; }", "--a")).toThrow(
      /@theme inline/
    );
  });
});
