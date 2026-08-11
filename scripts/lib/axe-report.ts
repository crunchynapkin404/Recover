// scripts/lib/axe-report.ts — pure axe-result classification, split out of
// verify-surfaces.ts (task-7 review, Finding 1) so it can be unit-tested
// (tests/axe-report-split.test.ts) and browser-tested end-to-end
// (scripts/axe-split-proof.ts) without running the full 40-capture browser
// pass. No fs, no playwright, no process — a plain function of axe-core's
// own result shape in, a typed report shape out.
//
// THE PROBLEM THIS FILE EXISTS TO SOLVE: axe's "incomplete" bucket mixes two
// completely different situations under one label:
//   1. axe COULD NOT resolve the colours, so there is no ratio — `data`
//      carries `contrastRatio: 0` (messageKey "bgGradient" /
//      "elmPartiallyObscured" / "elmPartiallyObscuring" / "imgNode" /
//      "colorParse", and — see below — sometimes "shortTextContent"), or no
//      ratio field at all ("nonBmp", "pseudoContent", "complexTextShadows"),
//      or `data: null` entirely for other rules such as "bypass". This is axe
//      asking a human to look; there is no number to fail or pass.
//   2. axe DID resolve both colours, DID compute a ratio, and the ratio FAILS
//      the threshold axe itself carries in the same `data`
//      (`expectedContrastRatio: "4.5:1"`) — yet axe still files the node
//      under "incomplete" rather than "violations". There are two such
//      branches in axe's color-contrast evaluate, not one:
//        - messageKey "equalRatio", contrastRatio 1 — genuinely invisible
//          text (opaque white-on-white);
//        - messageKey "shortTextContent" — the text is ONE CHARACTER, so axe
//          asks for a human eye even though it computed the number. Verified
//          verbatim against real axe-core 4.13:
//          `{fgColor:"#8a8a8a", bgColor:"#ffffff", contrastRatio:3.45,
//            messageKey:"shortTextContent", expectedContrastRatio:"4.5:1"}`.
// verify-surfaces.ts's original `blocking` array (task 7) bundled case 1 and
// case 2 into one bucket that drove `process.exitCode`. On this app's four
// gradient-background surfaces (today/train/coach/body), case 1 is permanent
// — no foreground-colour fix can ever make axe's color-contrast rule resolve
// a composited gradient — so gating the exit code on it made "drive the
// number to zero" impossible to satisfy no matter what a slice fixed.
//
// AND THEN THE FIRST FIX OVER-CORRECTED (C3, whole-branch review
// 2026-08-11): isComputedFailure required `messageKey === "equalRatio" &&
// contrastRatio === 1`, i.e. only PERFECTLY INVISIBLE text. Every
// shortTextContent node — where axe resolved both colours and computed a
// failing ratio — was filed as indeterminate and could not gate the exit
// code. Proven in a real browser: a page whose sole defect was a single digit
// at 3.45:1 exited 0. On this app single-character text is `%`, `·`, lone
// digits, single-letter axis and weekday labels — the smallest, densest
// content on Train and Body, which is what v0.99 is about. (The ▲/▼ trend
// arrows are a different case again: axe returns `{messageKey:"nonBmp"}` with
// no ratio for those, so they are honestly indeterminate.)
//
// THE LINE IS THEREFORE DRAWN AT "DID AXE COMPUTE A FAILING NUMBER", NOT AT
// A MESSAGE KEY — see isComputedFailure. The same messageKey appears on both
// sides of it: one character over an unresolvable gradient really does emit
// `{contrastRatio: 0, messageKey: "shortTextContent"}` (also verified in a
// real browser), and that one is indeterminate, because there is no number.
//
// DO NOT re-merge `confirmed` and `indeterminate` back into one bucket. That
// is the exact regression this file exists to prevent — see the DO NOT
// comment on isComputedFailure below for the specific reason.
import type Axe from "axe-core";

/**
 * axe-core impact levels this audit treats as blocking (Task 7 brief).
 * "minor"/"moderate" findings exist but are not what this release's guards
 * (contrast-guard, type-scale-guard) target, and including them would drown
 * slice 1-8's actual target list in noise unrelated to this release.
 */
export const BLOCKING_IMPACTS: ReadonlySet<Axe.ImpactValue> = new Set([
  "serious",
  "critical",
]);

export type ResultType = "violation" | "incomplete";

export type AxeFinding = Pick<
  Axe.Result,
  "id" | "impact" | "description" | "help" | "helpUrl"
> & {
  nodes: Axe.NodeResult[];
  /**
   * Which raw axe bucket this finding's nodes came from. Every node in a
   * `confirmed` finding is either `resultType: "violation"` (axe was always
   * certain) or an `"incomplete"` node axe nonetheless computed a failing
   * ratio for (see isComputedFailure). Every node in an `indeterminate`
   * finding is `"incomplete"` and axe could not compute a ratio at all.
   */
  resultType: ResultType;
};

export interface SplitFindings {
  /** Axe actually computed a failure. THIS is what should gate a pass/fail exit code. */
  confirmed: AxeFinding[];
  /**
   * Axe could not compute an answer at all. Must be reported, but must
   * NEVER gate the exit code — see file header. This number is not noise:
   * it counts text lacking an opaque background, which is exactly what
   * giving cards real surface tokens fixes, so it should trend to zero
   * across slices too — just for a different reason (opaque backgrounds
   * making the check resolvable) and via a different mechanism (this
   * number shrinking, not an exit-code gate) than `confirmed`.
   */
  indeterminate: AxeFinding[];
}

/** axe's own `expectedContrastRatio: "4.5:1"` → 4.5. */
function thresholdOf(expected: unknown): number | null {
  if (typeof expected !== "string") return null;
  const m = /^\s*([\d.]+)\s*:\s*1\s*$/.exec(expected);
  if (!m) return null;
  const n = Number.parseFloat(m[1]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * True when axe actually computed a contrast ratio for this node AND that
 * ratio fails the threshold axe carries alongside it — whichever bucket the
 * node arrived in and whatever messageKey it wears. That is the whole
 * condition, and it is deliberately about the NUMBER, because the message key
 * does not separate the two cases: `shortTextContent` appears both with a real
 * failing ratio (opaque background, one character) and with `contrastRatio: 0`
 * (that same one character over a gradient axe cannot resolve).
 *
 * Read against axe-core 4.13's own `colorContrastEvaluate`, not inferred:
 *   - `contrastRatio` is `Math.floor(contrast * 100) / 100`, and `contrast` is
 *     null exactly when a colour could not be resolved — so a `0` here means
 *     "no number", never "1:1", which is why `> 0` is the resolvability test.
 *   - axe's own verdict is `isValid = contrast > expected` (strictly greater),
 *     so `ratio <= threshold` is a failure by axe's own arithmetic, not by a
 *     rounder or stricter rule of ours.
 *   - a node that has a ratio and PASSES never reaches the incomplete bucket
 *     (evaluate returns true), so this cannot promote a passing node.
 *
 * Everything else stays indeterminate, and that half is load-bearing: no
 * ratio field at all (`nonBmp`, `pseudoContent`, `complexTextShadows`),
 * `contrastRatio: 0` (`bgGradient`, `elmPartiallyObscured`,
 * `elmPartiallyObscuring`, `imgNode`, `colorParse`), `data: null` for other
 * rules entirely (axe's "bypass" skip-link heuristic), or a ratio with no
 * parseable threshold to judge it against — nothing in axe 4.13 emits that
 * last shape into `incomplete` (link-in-text-block's ratio-bearing branches
 * `return false`, i.e. they land in `violations`), and if something ever does,
 * failing closed to "report, do not gate" is the safe direction.
 *
 * DO NOT collapse this back into "any incomplete result is indeterminate."
 * A small but real slice of "incomplete" results are not actually
 * indeterminate; axe just files them under the wrong-sounding bucket name.
 * Losing that distinction is exactly the regression this function exists to
 * prevent (task-7 review, Finding 1) — it is what makes the four gradient
 * surfaces' exit code unfalsifiable if merged back together. And DO NOT
 * narrow it back to a messageKey allow-list either: that was C3, and it let
 * every one-character defect in the app through a gate that looked green.
 */
export function isComputedFailure(node: Axe.NodeResult): boolean {
  return [...node.any, ...node.all, ...node.none].some((check) => {
    const data = check.data as
      | { contrastRatio?: unknown; expectedContrastRatio?: unknown }
      | null
      | undefined;
    if (typeof data?.contrastRatio !== "number" || data.contrastRatio <= 0) {
      return false;
    }
    const threshold = thresholdOf(data.expectedContrastRatio);
    return threshold !== null && data.contrastRatio <= threshold;
  });
}

function toFinding(
  result: Axe.Result,
  resultType: ResultType,
  nodes: Axe.NodeResult[]
): AxeFinding {
  const { id, impact, description, help, helpUrl } = result;
  return { id, impact, description, help, helpUrl, nodes, resultType };
}

/**
 * Splits axe's raw `violations` and `incomplete` results — already the
 * whole, unfiltered arrays axe-core returns — into `confirmed` (gates the
 * exit code) and `indeterminate` (reported, never gates). Impact filtering
 * (serious/critical only, per BLOCKING_IMPACTS) happens here so callers
 * never have to remember to apply it twice. `violations`-bucket results are
 * axe-certain by definition, so they pass through whole; `incomplete`-bucket
 * results are split node-by-node with isComputedFailure, since a single
 * result (rule) can — and in the real data routinely does — mix nodes axe
 * computed a failing ratio for with genuinely indeterminate ones. The
 * measured count is in docs/axe-baseline-2026-08-11-seeded.md rather than
 * repeated here, so a re-measurement cannot leave a stale number behind.
 */
export function splitFindings(
  violations: Axe.Result[],
  incomplete: Axe.Result[]
): SplitFindings {
  const confirmed: AxeFinding[] = [];
  const indeterminate: AxeFinding[] = [];

  for (const v of violations) {
    if (!BLOCKING_IMPACTS.has(v.impact ?? null)) continue;
    if (v.nodes.length > 0) confirmed.push(toFinding(v, "violation", v.nodes));
  }

  for (const r of incomplete) {
    if (!BLOCKING_IMPACTS.has(r.impact ?? null)) continue;
    const confirmedNodes = r.nodes.filter(isComputedFailure);
    const indeterminateNodes = r.nodes.filter((n) => !isComputedFailure(n));
    if (confirmedNodes.length > 0)
      confirmed.push(toFinding(r, "incomplete", confirmedNodes));
    if (indeterminateNodes.length > 0)
      indeterminate.push(toFinding(r, "incomplete", indeterminateNodes));
  }

  return { confirmed, indeterminate };
}

/** DOM nodes covered by a list of findings — the metric that should lead (see file header and CHANGELOG-worthy lesson in docs/axe-baseline-2026-08-11-seeded.md: rule-level counts hid a real +20.7% node-level regression). */
export function countNodes(findings: readonly AxeFinding[]): number {
  return findings.reduce((sum, f) => sum + f.nodes.length, 0);
}

export interface ReportTotals {
  confirmedRuleRows: number;
  confirmedNodes: number;
  indeterminateRuleRows: number;
  indeterminateNodes: number;
}

/**
 * Totals across every surface/theme/viewport entry in a run. Node counts
 * lead (see file header); rule-row counts (one row per
 * surface/theme/viewport/rule-id/resultType) are the secondary, more
 * easily-gamed number — see docs/axe-baseline-2026-08-11-seeded.md for the
 * measured case where rule-rows moved 46→44 while nodes moved
 * 1398→1687 (+20.7%), with Train +600% and Today +240%.
 */
export function computeTotals(
  entries: readonly { confirmed: AxeFinding[]; indeterminate: AxeFinding[] }[]
): ReportTotals {
  let confirmedRuleRows = 0;
  let confirmedNodes = 0;
  let indeterminateRuleRows = 0;
  let indeterminateNodes = 0;
  for (const e of entries) {
    confirmedRuleRows += e.confirmed.length;
    confirmedNodes += countNodes(e.confirmed);
    indeterminateRuleRows += e.indeterminate.length;
    indeterminateNodes += countNodes(e.indeterminate);
  }
  return {
    confirmedRuleRows,
    confirmedNodes,
    indeterminateRuleRows,
    indeterminateNodes,
  };
}
