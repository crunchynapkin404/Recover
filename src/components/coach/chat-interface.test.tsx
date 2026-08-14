import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";

describe("ChatInterface source invariants", () => {
  it("does not stamp messages with the render time", () => {
    // The old markup called new Date() inside messages.map, so every bubble
    // showed the clock at render. Nothing in the client transport carries a
    // per-message time, so the honest rendering is none at all.
    const src = readFileSync(
      new URL("./chat-interface.tsx", import.meta.url),
      "utf8"
    );
    expect(src).not.toMatch(/new Date\(\)\.toLocaleTimeString/);
  });
});
