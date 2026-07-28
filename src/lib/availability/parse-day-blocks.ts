import { validateBlocks, type AvailabilityBlock } from "./types";

// Lives outside src/app/plan/actions.ts because that file is "use server":
// every export there must be an async server action, and a sync helper
// exported from it fails the production build ("Server Actions must be async
// functions") even though tsc, lint and vitest all pass.

/**
 * One day's blocks out of a form field, or null when the field cannot be
 * understood. Never returns a half-understood block.
 *
 * null is deliberately NOT the same as `[]`. An empty list is a real answer
 * ("I have no time that day"), and submitAvailability both pins it as an
 * override and moves that day's sessions away — so reading garbage as a rest
 * day is the most destructive available interpretation, not the safe one.
 * The caller refuses the whole submission instead.
 *
 * A missing field is still `[]`: the form always emits all seven days, so an
 * absent one means the day genuinely holds nothing.
 *
 * Pure and exported for its own tests: server actions need a session, this
 * does not.
 */
export function parseDayBlocks(
  raw: FormDataEntryValue | null
): AvailabilityBlock[] | null {
  if (raw == null) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(String(raw));
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) return null;
  const blocks = parsed as AvailabilityBlock[];
  return validateBlocks(blocks) === null ? blocks : null;
}
