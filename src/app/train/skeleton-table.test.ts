import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ARBITRARY_TYPE, ADHOC_INK } from "@/lib/design/type-scale-patterns";

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

  // I6, whole-branch review 2026-08-12: this test's positional /<table
  // className="…"/.exec above checks only the FIRST <table> in the file.
  // That is correct today because there is exactly one — but Task 10
  // (Season timeline) and Task 11 (Fitness) both restructure parts of this
  // 1,537-line file, above and below page.tsx:1018's table. If either
  // lands a second <table> earlier in the file, the assertion above starts
  // silently checking a different element while still passing. Asserting
  // the count directly makes that fail loudly instead.
  it("has exactly one <table> in the file", () => {
    const tables = SOURCE.match(/<table\b/g) ?? [];
    expect(tables).toHaveLength(1);
  });

  // This is the only assertion that holds the WHOLE of page.tsx to the 12px
  // floor. It was written as `it.fails` because it could not pass yet — Task 6
  // migrated only the Week tab's chrome, leaving the History and Fitness
  // halves unmigrated — and Task 11 flipped it once Fitness was clean.
  // THAT FLIP HAPPENED: this is a plain `it(` and it passes. Corrected
  // 2026-09-04, when the paragraph still said "it can't pass yet" and named
  // an `it.fails` that no longer exists anywhere in the repo.
  //
  // I6, whole-branch review 2026-08-12: this used to re-spell its own,
  // narrower copies of the two offender patterns
  // (text-\[[\d.]+px\]/text-white\//bg-white\//border-white\ only) while
  // the comment above claimed to hold the whole file to the same floor
  // tests/type-scale-guard.test.ts enforces. That let text-[0.6rem],
  // ring-white/N, divide-white/N, fill-white/N and every *-black/N pass
  // silently. Now imports the same two patterns the sibling guard uses, so
  // the two cannot drift apart again.
  it("keeps no type below the floor anywhere in the page", () => {
    expect(SOURCE.match(new RegExp(ARBITRARY_TYPE.source, "g"))).toBeNull();
    expect(SOURCE.match(new RegExp(ADHOC_INK.source, "g"))).toBeNull();
  });
});
