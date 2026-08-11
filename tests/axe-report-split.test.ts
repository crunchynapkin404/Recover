// tests/axe-report-split.test.ts — committed proof for task-7 review,
// Finding 1: the split between "confirmed defect" (gates the exit code) and
// "indeterminate" (reported, never gates) actually discriminates, in both
// directions, rather than always/never reporting something.
//
// The result shapes below are not invented — they are the exact `data` shapes
// real axe-core 4.13 produces for the cases this app actually hits, captured
// by running axe against synthetic pages in the real sandboxed Chromium (see
// scripts/axe-split-proof.ts for the live, end-to-end version of this same
// proof, which exercises the identical splitFindings() against a real browser
// + real DOM rather than hand-built fixtures). Notably: opaque,
// fully-resolvable white-on-white text lands in axe's `incomplete` bucket with
// messageKey "equalRatio", NOT in `violations` — which is exactly why a naive
// "trust the bucket name" split would misclassify it as indeterminate.
//
// ── THIS FILE'S OWN PREMISE WAS WRONG, AND BLESSED THE HOLE (C3, whole-branch
// review 2026-08-11) ────────────────────────────────────────────────────────
// It used to pin `shortTextContent` as not-a-failure, from a fabricated
// `{contrastRatio: 0, messageKey: "shortTextContent"}` — asserted in a loop
// beside two keys that genuinely never carry a ratio. That made a committed
// test out of the assumption that a message key decides the question, and it
// is the key that does not decide it: axe emits `shortTextContent` on BOTH
// sides of the line, and the ratio is what separates them.
//
//   SHORT TEXT, OPAQUE BACKGROUND — axe resolved both colours and computed
//   3.45:1 against a 4.5:1 threshold. A real, confirmed defect that the old
//   rule filed as "axe could not tell":
//     {fgColor:"#8a8a8a", bgColor:"#ffffff", contrastRatio:3.45,
//      messageKey:"shortTextContent", expectedContrastRatio:"4.5:1"}
//
//   SHORT TEXT, GRADIENT BACKGROUND — same key, no number, because
//   `missing` is overwritten to "shortTextContent" even when bgColor was
//   null. Genuinely indeterminate:
//     {contrastRatio:0, messageKey:"shortTextContent",
//      expectedContrastRatio:"4.5:1"}
//
// Both captured verbatim from axe-core 4.13 in the real browser. The old
// fixture was therefore a shape axe does emit — for the OTHER case — which is
// what made the false premise so easy to believe.
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

// Captured verbatim from real axe-core 4.13 (`npx tsx scripts/axe-split-proof.ts`
// against synthetic pages — see that script's HTML_A/HTML_B/HTML_C/HTML_D/HTML_E):
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
/** One character, opaque background: axe computed 3.45:1 against 4.5:1. */
const SHORT_TEXT_COMPUTED_DATA = {
  fgColor: "#8a8a8a",
  bgColor: "#ffffff",
  contrastRatio: 3.45,
  fontSize: "12.0pt (16px)",
  fontWeight: "normal",
  messageKey: "shortTextContent",
  expectedContrastRatio: "4.5:1",
};
/** One character over a gradient: same key, no number to judge. */
const SHORT_TEXT_UNRESOLVED_DATA = {
  contrastRatio: 0,
  fontSize: "12.0pt (16px)",
  fontWeight: "normal",
  messageKey: "shortTextContent",
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

  // The C3 regression test. This shape used to be classified as
  // indeterminate, so a page whose only defect was a single digit at 3.45:1
  // exited 0.
  it("is true for one-character text axe DID compute a failing ratio for (shortTextContent, 3.45:1)", () => {
    expect(isComputedFailure(node(SHORT_TEXT_COMPUTED_DATA))).toBe(true);
  });

  it("is false when axe could not compute a ratio at all (bgGradient, contrastRatio 0)", () => {
    expect(isComputedFailure(node(BG_GRADIENT_DATA))).toBe(false);
  });

  // The other half of C3: the SAME messageKey, still indeterminate, because
  // there is no number. This is the discrimination the old messageKey-based
  // rule could not make in either direction.
  it("is false for one-character text over a gradient (shortTextContent, contrastRatio 0)", () => {
    expect(isComputedFailure(node(SHORT_TEXT_UNRESOLVED_DATA))).toBe(false);
  });

  it("is false for the messageKeys that never carry a ratio at all", () => {
    for (const messageKey of [
      "elmPartiallyObscuring",
      "elmPartiallyObscured",
      "imgNode",
      "colorParse",
    ]) {
      expect(isComputedFailure(node({ contrastRatio: 0, messageKey }))).toBe(
        false
      );
    }
    // These three return from axe's evaluate before any ratio exists, so the
    // field is absent rather than zero.
    for (const messageKey of ["nonBmp", "pseudoContent", "complexTextShadows"])
      expect(isComputedFailure(node({ messageKey }))).toBe(false);
  });

  it("is false for a computed ratio that PASSES its threshold", () => {
    expect(
      isComputedFailure(
        node({ contrastRatio: 7.3, expectedContrastRatio: "4.5:1" })
      )
    ).toBe(false);
  });

  // axe's own verdict is `isValid = contrast > expected`, strictly greater —
  // so exactly-at-threshold is a failure by axe's arithmetic, not ours.
  it("honours axe's own threshold, including large-text's 3:1", () => {
    expect(
      isComputedFailure(
        node({ contrastRatio: 4.5, expectedContrastRatio: "4.5:1" })
      )
    ).toBe(true);
    expect(
      isComputedFailure(
        node({ contrastRatio: 3.2, expectedContrastRatio: "3:1" })
      )
    ).toBe(false);
    expect(
      isComputedFailure(
        node({ contrastRatio: 2.9, expectedContrastRatio: "3:1" })
      )
    ).toBe(true);
  });

  it("is false for a ratio with no threshold to judge it against", () => {
    expect(isComputedFailure(node({ contrastRatio: 1.2 }))).toBe(false);
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

  // The C3 regression test at the level that actually matters: the exit code.
  it("FAIL half: one-character text at a computed 3.45:1 gates the exit code (it used to exit 0)", () => {
    const incomplete = [
      result("color-contrast", "serious", [node(SHORT_TEXT_COMPUTED_DATA)]),
    ];
    const { confirmed, indeterminate } = splitFindings([], incomplete);

    expect(confirmed).toHaveLength(1);
    expect(countNodes(confirmed)).toBe(1);
    expect(indeterminate).toHaveLength(0);
    expect(
      computeTotals([{ confirmed, indeterminate }]).confirmedNodes
    ).toBeGreaterThan(0);
  });

  // Same rule, same messageKey, opposite classification — driven only by
  // whether axe had a number.
  it("PASS half: one-character text over a gradient stays indeterminate, so it cannot gate the exit code", () => {
    const incomplete = [
      result("color-contrast", "serious", [node(SHORT_TEXT_UNRESOLVED_DATA)]),
    ];
    const { confirmed, indeterminate } = splitFindings([], incomplete);

    expect(confirmed).toHaveLength(0);
    expect(countNodes(indeterminate)).toBe(1);
    expect(computeTotals([{ confirmed, indeterminate }]).confirmedNodes).toBe(
      0
    );
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
