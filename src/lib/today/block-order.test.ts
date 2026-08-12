import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  BLOCK_ORDER,
  MOMENT_ONLY,
  MORNING_LEFT_COLUMN,
  VARIANT_FAMILY,
  blockConcept,
  type TodayBlockKey,
} from "./block-order";

const STATES = ["morning", "post-session", "evening"] as const;

function conceptsIn(state: (typeof STATES)[number]): Set<string> {
  return new Set(BLOCK_ORDER[state].map(blockConcept));
}

describe("Today's block order", () => {
  it("covers all three states", () => {
    expect(Object.keys(BLOCK_ORDER).sort()).toEqual([...STATES].sort());
  });

  /**
   * The governing rule, mechanically. Checked against CONCEPTS, not raw keys:
   * heroFull/heroCompact/heroRecap are one block at three emphases, and a
   * state picks one. Raw-key equality would fail a correct implementation.
   */
  it("shows every block in every state, except the moment-only ones", () => {
    const universe = new Set<string>();
    for (const s of STATES)
      for (const c of conceptsIn(s))
        if (!MOMENT_ONLY.has(c as TodayBlockKey)) universe.add(c);

    for (const s of STATES) {
      const missing = [...universe].filter((c) => !conceptsIn(s).has(c));
      expect(
        missing,
        `the "${s}" state is missing ${missing.join(", ")} — every state ` +
          `must show every block ("reorder, never hide"). Either add it to ` +
          `BLOCK_ORDER.${s}, or, if its subject genuinely is one moment, ` +
          `add it to MOMENT_ONLY with a reason.`
      ).toEqual([]);
    }
  });

  it("keeps MOMENT_ONLY small and justified", () => {
    // Not a style rule: every entry here is content one state shows and the
    // others hide. Growing this set silently is how the rule above erodes.
    expect([...MOMENT_ONLY].sort()).toEqual(["justLanded", "sessionTomorrow"]);
  });

  it("picks exactly one variant per family in each state", () => {
    const families = new Set(Object.values(VARIANT_FAMILY));
    for (const s of STATES) {
      for (const family of families) {
        const picked = BLOCK_ORDER[s].filter(
          (k) => VARIANT_FAMILY[k] === family
        );
        expect(
          picked.length,
          `the "${s}" state renders ${picked.length} of the "${family}" ` +
            `family (${picked.join(", ")}); it must render exactly one`
        ).toBe(1);
      }
    }
  });

  it("never repeats a key within a state", () => {
    for (const s of STATES) {
      const keys = BLOCK_ORDER[s];
      expect(new Set(keys).size, `"${s}" repeats a block`).toBe(keys.length);
    }
  });

  it("leads each state with the block that answers its moment", () => {
    expect(BLOCK_ORDER.morning[0]).toBe("heroFull");
    expect(BLOCK_ORDER["post-session"][0]).toBe("justLanded");
    expect(BLOCK_ORDER.evening[0]).toBe("dayLog");
  });

  it("draws the morning two-column split only from morning's own blocks", () => {
    for (const key of MORNING_LEFT_COLUMN) {
      expect(
        BLOCK_ORDER.morning.includes(key),
        `${key} is in the morning left column but not in morning's order, ` +
          `so the split would silently drop it`
      ).toBe(true);
    }
  });
});

/**
 * The list above is only worth anything if `page.tsx` actually renders from
 * it. A page that kept its own inline copy would let the two drift while
 * every assertion above stayed green — the exact failure the slice-0 retro
 * calls "a document outliving the code it described".
 */
describe("page.tsx renders from this order", () => {
  const src = readFileSync(join(process.cwd(), "src/app/page.tsx"), "utf8");

  it("imports BLOCK_ORDER rather than declaring its own", () => {
    expect(src).toMatch(/BLOCK_ORDER/);
    expect(
      src,
      "page.tsx declares its own ORDER map again — delete it and use " +
        "BLOCK_ORDER, or this file's tests guard nothing"
    ).not.toMatch(/const\s+ORDER\s*[:=]/);
  });

  it("defines a rendered block for every key the order names", () => {
    const every = new Set(Object.values(BLOCK_ORDER).flat());
    for (const key of every) {
      expect(
        src,
        `BLOCK_ORDER names "${key}" but page.tsx never defines it, so that ` +
          `slot renders nothing`
      ).toMatch(new RegExp(`\\b${key}\\s*:`));
    }
  });
});
