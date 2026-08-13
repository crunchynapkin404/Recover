import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SOURCE = readFileSync(
  join(process.cwd(), "src/app/train/page.tsx"),
  "utf8"
);

describe("Remaining skeleton table", () => {
  it("scrolls horizontally rather than shrinking its columns below the floor", () => {
    // At the 12px floor "Target load" as a tracked uppercase header plus
    // three columns' padding can exceed 380px. The decision table's
    // resolution is a scroll container, not narrower columns.
    const table = /<table className="([^"]*)"/.exec(SOURCE);
    expect(
      table,
      "the skeleton table should still be a real <table>"
    ).not.toBeNull();
    const before = SOURCE.slice(0, table!.index);
    expect(
      before.slice(-400),
      "the table needs an overflow-x-auto wrapper within 400 chars above it"
    ).toMatch(/overflow-x-auto/);
  });

  // This is the only assertion that holds the WHOLE 1,537-line page.tsx to
  // the 12px floor, so it is written now even though it can't pass yet:
  // Task 6 migrates only the Week tab's page-level chrome — the History
  // (Task 9) and Fitness (Task 11) halves of this same file still have
  // unmigrated text-[Npx]/white-alpha classes. Marked `it.fails` here so
  // the suite is never red between commits; Task 11 flips it to a plain
  // `it` once the Fitness migration leaves the whole file clean.
  it.fails("keeps no type below the floor anywhere in the page", () => {
    expect(SOURCE).not.toMatch(/text-\[[\d.]+px\]/);
    expect(SOURCE).not.toMatch(/text-white\//);
    expect(SOURCE).not.toMatch(/bg-white\//);
    expect(SOURCE).not.toMatch(/border-white\//);
  });
});
