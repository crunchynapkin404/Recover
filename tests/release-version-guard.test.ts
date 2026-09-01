import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const version = (
  JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8")) as {
    version: string;
  }
).version;

/**
 * `Current release:` rots, and nothing has ever caught it.
 *
 * In one session it was found wrong three separate times: README said v0.119.0
 * against a shipped v0.125.0 (seven releases behind), ROADMAP said v0.121.0
 * against the same, and ROADMAP was corrected to v0.125.0 and went stale again
 * the very next release. Every one was fixed by a person happening to read the
 * line, which is not a mechanism.
 *
 * It is a one-line claim that a machine can check against package.json, so it
 * should be. RELEASING.md step 2 already requires the bump; this makes
 * forgetting it fail rather than ship.
 */
const CLAIMS: [string, RegExp][] = [
  ["docs/ROADMAP.md", /Current release: \*\*v([\d.]+)\*\*/],
  ["README.md", /\*\*Current release: v([\d.]+)\.\*\*/],
];

describe("the documented current release", () => {
  it.each(CLAIMS)("matches package.json in %s", (file, pattern) => {
    const text = readFileSync(join(process.cwd(), file), "utf8");
    const found = pattern.exec(text);
    expect(
      found,
      `${file} no longer states a current release at all`
    ).not.toBeNull();
    expect(
      found![1],
      `${file} says v${found![1]} but package.json says v${version}. ` +
        "RELEASING.md step 2 bumps both; this is the check that it happened."
    ).toBe(version);
  });
});
