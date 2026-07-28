// src/lib/availability/resolve-day.ts
import type { AvailabilityBlock } from "./types";

/**
 * The whole precedence rule, in one pure function.
 *
 * An override is a complete replacement of that date, never a delta — so
 * an empty array means "unavailable that day", which is a different thing
 * from `null` ("no override row: use the weekday default"). Because
 * defaults and overrides are separate tables, editing a default can never
 * disturb a date the athlete already pinned.
 */
export function resolveDay(
  defaults: AvailabilityBlock[],
  override: AvailabilityBlock[] | null
): AvailabilityBlock[] {
  return override ?? defaults;
}
