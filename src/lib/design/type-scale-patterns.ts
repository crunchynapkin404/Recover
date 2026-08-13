/**
 * The two "floor-breaking" utility patterns every guard that claims to hold
 * a surface to the 12px type scale checks for. Moved here (I6, whole-branch
 * review 2026-08-12) because `src/app/train/skeleton-table.test.ts` had
 * re-spelled its own, narrower copies while its comment claimed to hold the
 * WHOLE page to the same floor `tests/type-scale-guard.test.ts` enforces —
 * several arbitrary-unit and ad-hoc-ink spellings the narrower copies missed
 * passed undetected. One spelling, imported everywhere, so the two guards
 * cannot drift apart again. See tests/type-scale-guard.test.ts's comments
 * (a test file, excluded from the src/ scan below) for concrete examples of
 * what each pattern catches — deliberately not repeated here, since this
 * file lives inside the tree the patterns themselves scan.
 */

/** Arbitrary Tailwind type-size utilities, in any of the three CSS units. */
export const ARBITRARY_TYPE = /\btext-\[[^\]]*(?:px|rem|em)\]/g;

/**
 * Ad-hoc white/black ink at an alpha, across every colour-bearing Tailwind
 * prefix and both of its opacity syntaxes (suffix-slash-number and the
 * bracketed arbitrary form).
 */
export const ADHOC_INK =
  /\b(?:text|bg|border|fill|stroke|ring|divide)-(?:white|black)\/(?:\d+|\[[^\]]+\])/g;
