// scripts/lib/axe-report.ts — pure axe-result classification, split out of
// verify-surfaces.ts (task-7 review, Finding 1) so it can be unit-tested
// (tests/axe-report-split.test.ts) and browser-tested end-to-end
// (scripts/axe-split-proof.ts) without running the full 40-capture browser
// pass. No fs, no playwright, no process — a plain function of axe-core's
// own result shape in, a typed report shape out.
//
// THE PROBLEM THIS FILE EXISTS TO SOLVE: axe's "incomplete" bucket mixes two
// completely different situations under one label:
//   1. axe COULD NOT compute a contrast ratio at all — messageKey
//      "bgGradient" / "elmPartiallyObscuring" / "elmPartiallyObscured" /
//      "shortTextContent" / "imgNode", contrastRatio: 0 (or, for entirely
//      different rules like "bypass", `data: null`). This is axe asking a
//      human to look; there is no number to fail or pass.
//   2. axe COMPUTED a ratio and it came out at 1:1 — messageKey
//      "equalRatio", contrastRatio: 1 — genuinely invisible text — but axe
//      still files it under "incomplete" rather than "violations" (verified
//      empirically against real axe-core 4.13: opaque white-on-white lands
//      in `incomplete`, not `violations`; see tests/axe-report-split.test.ts
//      and scripts/axe-split-proof.ts for the reproduction).
// verify-surfaces.ts's original `blocking` array (task 7) bundled both into
// one bucket that drove `process.exitCode`. On this app's four gradient-
// background surfaces (today/train/coach/body), case 1 above is permanent —
// no foreground-colour fix can ever make axe's color-contrast rule resolve
// a composited gradient — so gating the exit code on it made "drive the
// number to zero" impossible to satisfy no matter what a slice fixed.
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
   * certain) or an `"incomplete"` node axe nonetheless computed as a
   * definite 1:1 (see isComputedFailure). Every node in an `indeterminate`
   * finding is `"incomplete"` and axe could not compute an answer at all.
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

/**
 * True only when axe actually computed a numeric contrast ratio for this
 * node and it came out at the 1:1 floor — genuinely invisible text, not
 * merely "axe couldn't tell." Every other shape in a node's checks (a
 * computed `contrastRatio: 0` — axe's own signal that it could NOT compute
 * a ratio at all, tagged `bgGradient`/`elmPartiallyObscuring`/
 * `elmPartiallyObscured`/`shortTextContent`/`imgNode` — or `data: null`
 * entirely, e.g. axe's "bypass" skip-link heuristic) means axe is asking a
 * human to look, which is a structurally different claim from "this is a
 * defect axe found."
 *
 * DO NOT collapse this back into "any incomplete result is indeterminate."
 * A small but real slice of "incomplete" results (the
 * `equalRatio`/`contrastRatio: 1` ones — 332 of them in the first baseline,
 * 390 in the seeded one) are not actually indeterminate; axe just files
 * them under the wrong-sounding bucket name. Losing that distinction is
 * exactly the regression this function exists to prevent (task-7 review,
 * Finding 1) — it is what makes the four gradient surfaces' exit code
 * unfalsifiable if merged back together.
 */
export function isComputedFailure(node: Axe.NodeResult): boolean {
  return [...node.any, ...node.all, ...node.none].some((check) => {
    const data = check.data as
      { messageKey?: string; contrastRatio?: number } | null | undefined;
    return data?.messageKey === "equalRatio" && data?.contrastRatio === 1;
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
 * result (rule) can — and in the real data does, 19 times in the seeded
 * baseline — mix confirmed 1:1 nodes with genuinely indeterminate ones.
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
