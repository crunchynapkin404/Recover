/**
 * The motion equivalents of `type-scale-patterns.ts` — one spelling of each
 * scan, imported by every guard that claims to hold the app to the motion
 * scale, for that file's stated reason: guards that re-spell a scan drift
 * apart, and the drift is invisible until something slips through the
 * narrower copy.
 *
 * WHY A SOURCE SCAN IS SOUND FOR THE TWO TAILWIND PATTERNS: Tailwind v4 only
 * compiles classes that appear as literal strings in source, so a class
 * assembled at runtime cannot defeat the scan — it produces no CSS either.
 * That argument is `type-scale-guard.test.ts`'s and it is repeated here
 * because it is the load-bearing one. What it does NOT cover is motion set
 * from an inline `style={{ transition: … }}`; there are none in `src/` as of
 * 2026-08-30 (`grep -rn 'transition\|animation' src --include=*.tsx | grep
 * 'style={{'`), and the ceiling in tests/motion-scale-guard.test.ts is what
 * would notice if the total moved without this pattern seeing why.
 */

/**
 * A duration or easing curve written out rather than referenced as a token.
 *
 * Durations must be preceded by whitespace or `(` and be a real time value,
 * so `repeat(3, 1fr)` and `flex: 1 1 0%` do not match. A `--duration-*` /
 * `--ease-*` declaration line is excluded by the negative lookbehind, so the
 * scale never counts as its own offender.
 */
export const HANDWRITTEN_MOTION =
  /(?<!--[\w-]{0,40}:\s{0,4})(?<=[\s(])\d+(?:\.\d+)?m?s(?=[\s,;)])|(?<!--[\w-]{0,40}:\s{0,4})cubic-bezier\([^)]*\)/g;

/** `transition-all` — animates every property, including `:active` transforms. */
export const TRANSITION_ALL = /\btransition-all\b/g;

/** Tailwind's numeric duration utilities, which bypass the token scale. */
export const NUMERIC_DURATION = /\bduration-\d+\b/g;
