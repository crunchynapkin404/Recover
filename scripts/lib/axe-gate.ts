/**
 * Whether the axe totals contribute to verify-surfaces.ts's exit code.
 *
 * WHY THIS EXISTS. The script fails the run when `confirmed > 0`. That is
 * right for a person running it: they asked about this slice, and a confirmed
 * defect is the answer. It is wrong inside `.github/workflows/surfaces.yml`,
 * because a zero threshold is exactly what CONTRIBUTING.md names as the
 * decisive reason the capture was never a CI gate — "a red suite for eight
 * slices, which is how a check gets disabled".
 *
 * The replacement is the ratchet (scripts/lib/surface-ratchet.ts): fail on a
 * RISE against a committed ceiling. But the ratchet runs in a later job, over
 * BOTH captures summed, and it never got the chance — the capture step's
 * non-zero exit failed its job first and the ratchet job was skipped for a
 * failed dependency. Measured on run 32368432220: 10 confirmed nodes across
 * 108 entries, so both capture jobs failed and nothing adjudicated them.
 *
 * `--no-axe-gate` removes ONLY the axe totals from the exit decision. Hard
 * failures — a surface reached and then failed, an un-revoked API token,
 * byte-identical Today states, a block-order mismatch — still fail the run,
 * because those mean the capture itself is not trustworthy and no downstream
 * ratchet can tell.
 */
export function axeGateEnabled(argv: readonly string[]): boolean {
  return !argv.includes("--no-axe-gate");
}
