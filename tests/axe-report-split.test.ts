// tests/axe-report-split.test.ts — committed proof for task-7 review,
// Finding 1: the split between "confirmed defect" (gates the exit code) and
// "indeterminate" (reported, never gates) actually discriminates, in both
// directions, rather than always/never reporting something.
//
// The three result shapes below (equalRatio/1, bgGradient/0, and a plain
// resolvable violation) are not invented — they are the exact `data` shapes
// real axe-core 4.13 produces for the three cases this app actually hits,
// captured by running axe against synthetic pages in the real sandboxed
// Chromium (see scripts/axe-split-proof.ts for the live, end-to-end version
// of this same proof, which exercises the identical splitFindings() against
// a real browser + real DOM rather than hand-built fixtures). Notably:
// opaque, fully-resolvable white-on-white text lands in axe's `incomplete`
// bucket with messageKey "equalRatio", NOT in `violations` — which is
// exactly why a naive "trust the bucket name" split would misclassify it as
// indeterminate. isComputedFailure looks at `messageKey`/`contrastRatio`
// instead of the bucket name for this reason.
import { describe, it, expect } from "vitest";
import type Axe from "axe-core";
import {
  splitFindings,
  isComputedFailure,
  computeTotals,
  countNodes,
} from "../scripts/lib/axe-report";

/** Minimal but real-shaped axe-core NodeResult — only the fields splitFindings reads. */
function node(
  data: Record<string, unknown> | null,
  html = "<p>x</p>"
): Axe.NodeResult {
  return {
    html,
    target: ["p"],
    any: [{ id: "color-contrast", impact: "serious", message: "", data }],
    all: [],
    none: [],
  } as unknown as Axe.NodeResult;
}

function result(
  id: string,
  impact: Axe.ImpactValue,
  nodes: Axe.NodeResult[]
): Axe.Result {
  return {
    id,
    impact,
    description: `desc-${id}`,
    help: `help-${id}`,
    helpUrl: `https://example.test/${id}`,
    tags: [],
    nodes,
  } as unknown as Axe.Result;
}

// Captured verbatim from real axe-core 4.13 (`node scripts/axe-split-proof.ts`
// against synthetic pages — see that script's HTML_A/HTML_B/HTML_E):
const EQUAL_RATIO_DATA = {
  fgColor: "#ffffff",
  bgColor: "#ffffff",
  contrastRatio: 1,
  messageKey: "equalRatio",
  expectedContrastRatio: "4.5:1",
};
const BG_GRADIENT_DATA = {
  contrastRatio: 0,
  messageKey: "bgGradient",
  expectedContrastRatio: "4.5:1",
};
const LOW_RATIO_VIOLATION_DATA = {
  fgColor: "#777777",
  bgColor: "#666666",
  contrastRatio: 1.28,
  messageKey: null,
  expectedContrastRatio: "4.5:1",
};

describe("isComputedFailure", () => {
  it("is true for a genuinely computed 1:1 ratio (equalRatio)", () => {
    expect(isComputedFailure(node(EQUAL_RATIO_DATA))).toBe(true);
  });

  it("is false when axe could not compute a ratio at all (bgGradient, contrastRatio 0)", () => {
    expect(isComputedFailure(node(BG_GRADIENT_DATA))).toBe(false);
  });

  it("is false for the other documented could-not-compute messageKeys", () => {
    for (const messageKey of [
      "elmPartiallyObscuring",
      "elmPartiallyObscured",
      "shortTextContent",
    ]) {
      expect(isComputedFailure(node({ contrastRatio: 0, messageKey }))).toBe(
        false
      );
    }
  });

  it("is false when a check's data is null (e.g. axe's bypass rule)", () => {
    expect(isComputedFailure(node(null))).toBe(false);
  });
});

describe("splitFindings — the exit-code-relevant discrimination", () => {
  it("FAIL half: a confirmed 1:1 filed under axe's incomplete bucket is classified as confirmed, not indeterminate", () => {
    const incomplete = [
      result("color-contrast", "serious", [node(EQUAL_RATIO_DATA)]),
    ];
    const { confirmed, indeterminate } = splitFindings([], incomplete);

    expect(confirmed).toHaveLength(1);
    expect(confirmed[0].resultType).toBe("incomplete");
    expect(countNodes(confirmed)).toBe(1);
    expect(indeterminate).toHaveLength(0);

    // This is the exact condition verify-surfaces.ts's main() gates
    // process.exitCode on — confirming it would fire non-zero here.
    expect(
      computeTotals([{ confirmed, indeterminate }]).confirmedNodes
    ).toBeGreaterThan(0);
  });

  it("FAIL half: a plain axe-certain violation is classified as confirmed", () => {
    const violations = [
      result("color-contrast", "serious", [node(LOW_RATIO_VIOLATION_DATA)]),
    ];
    const { confirmed, indeterminate } = splitFindings(violations, []);

    expect(confirmed).toHaveLength(1);
    expect(confirmed[0].resultType).toBe("violation");
    expect(indeterminate).toHaveLength(0);
    expect(
      computeTotals([{ confirmed, indeterminate }]).confirmedNodes
    ).toBeGreaterThan(0);
  });

  it("PASS half: an indeterminate-only result (axe could not compute anything) never lands in confirmed, so it cannot gate the exit code", () => {
    const incomplete = [
      result("color-contrast", "serious", [
        node(BG_GRADIENT_DATA),
        node({ contrastRatio: 0, messageKey: "elmPartiallyObscured" }),
      ]),
    ];
    const { confirmed, indeterminate } = splitFindings([], incomplete);

    expect(confirmed).toHaveLength(0);
    expect(indeterminate).toHaveLength(1);
    expect(countNodes(indeterminate)).toBe(2);

    // The exact condition verify-surfaces.ts's main() gates on: with zero
    // confirmed nodes across the whole run, process.exitCode is never set —
    // an indeterminate-only result does not gate the exit code.
    const totals = computeTotals([{ confirmed, indeterminate }]);
    expect(totals.confirmedNodes).toBe(0);
    expect(totals.indeterminateNodes).toBe(2);
  });

  it("a single rule instance can mix confirmed and indeterminate nodes (the real, measured case — 19 times in the seeded baseline)", () => {
    const incomplete = [
      result("color-contrast", "serious", [
        node(EQUAL_RATIO_DATA, "<p>invisible</p>"),
        node(BG_GRADIENT_DATA, "<p>ambiguous</p>"),
      ]),
    ];
    const { confirmed, indeterminate } = splitFindings([], incomplete);

    expect(confirmed).toHaveLength(1);
    expect(confirmed[0].nodes).toHaveLength(1);
    expect(confirmed[0].nodes[0].html).toBe("<p>invisible</p>");

    expect(indeterminate).toHaveLength(1);
    expect(indeterminate[0].nodes).toHaveLength(1);
    expect(indeterminate[0].nodes[0].html).toBe("<p>ambiguous</p>");
  });

  it("moderate/minor impact is dropped from both buckets, matching BLOCKING_IMPACTS", () => {
    const violations = [result("some-rule", "moderate", [node(null)])];
    const incomplete = [
      result("color-contrast", "minor", [node(EQUAL_RATIO_DATA)]),
    ];
    const { confirmed, indeterminate } = splitFindings(violations, incomplete);

    expect(confirmed).toHaveLength(0);
    expect(indeterminate).toHaveLength(0);
  });
});

describe("computeTotals — node counts lead, rule-row counts are the secondary number", () => {
  it("sums both metrics independently across multiple report entries", () => {
    const entryA = splitFindings(
      [
        result("color-contrast", "critical", [
          node(LOW_RATIO_VIOLATION_DATA),
          node(LOW_RATIO_VIOLATION_DATA),
        ]),
      ],
      []
    );
    const entryB = splitFindings(
      [],
      [result("color-contrast", "serious", [node(BG_GRADIENT_DATA)])]
    );

    const totals = computeTotals([entryA, entryB]);
    expect(totals).toEqual({
      confirmedRuleRows: 1,
      confirmedNodes: 2,
      indeterminateRuleRows: 1,
      indeterminateNodes: 1,
    });
  });
});
