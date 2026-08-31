import type { LibraryWorkout } from "./types";

/**
 * The curated cycling library. Hand-authored, and the reason this feature
 * reverses a recorded non-goal — see the spec's "The reversal, recorded".
 *
 * Every workout carries a `source` naming its provenance, a confidence label,
 * and what would raise it. They are coaching conventions and they say so; a
 * shape dressed up as a citation it does not have would break the admission
 * gate the whole reversal rests on.
 *
 * Ids are stable and never renumbered — selection sorts on them.
 */
export const LIBRARY: readonly LibraryWorkout[] = [];
