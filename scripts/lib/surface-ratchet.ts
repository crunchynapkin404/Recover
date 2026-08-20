/**
 * The axe ratchet. CONTRIBUTING.md's decisive reason verify-surfaces was not
 * a CI gate: a zero threshold would fail every pull request while the recorded
 * baseline is deliberately non-zero, and a permanently red check is a check
 * that gets disabled. So gate on a RISE against a committed ceiling, the shape
 * tests/type-scale-guard.test.ts already uses.
 *
 * Only `confirmedNodes` gates. `indeterminate` is reported and never gates:
 * on this app's four gradient-background surfaces axe can never compute an
 * answer, so gating it would make "drive the number to zero" unreachable.
 *
 * Node counts, not rule rows — docs/axe-baseline-2026-08-11-seeded.md records
 * rule-rows moving 46 -> 44 while nodes moved 1398 -> 1687.
 */
import type { ReportTotals } from "./axe-report";

export interface Ceilings {
  confirmedNodes: number;
}

export interface RatchetResult {
  ok: boolean;
  message: string;
  shouldRepin: boolean;
}

export function checkRatchet(
  totals: ReportTotals,
  ceilings: Ceilings,
  slack: number
): RatchetResult {
  const actual = totals.confirmedNodes;
  const ceiling = ceilings.confirmedNodes;

  if (actual > ceiling + slack) {
    return {
      ok: false,
      message:
        `axe ratchet: ${actual} confirmed defect nodes, ceiling ${ceiling} ` +
        `(slack ${slack}). Something regressed. Open the capture artifact ` +
        `before raising the ceiling — raising it needs a reason in the ` +
        `commit message.`,
      shouldRepin: false,
    };
  }

  if (actual < ceiling) {
    return {
      ok: true,
      message:
        `axe ratchet: ${actual} confirmed defect nodes, down from ${ceiling}. ` +
        `Re-pin with: npm run verify:ratchet -- <slices> --update`,
      shouldRepin: true,
    };
  }

  return {
    ok: true,
    message: `axe ratchet: ${actual} confirmed defect nodes, ceiling ${ceiling}.`,
    shouldRepin: false,
  };
}
