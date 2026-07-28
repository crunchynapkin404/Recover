// src/lib/availability/format.ts
import { formatDuration } from "@/lib/format";
import { blockMins, type AvailabilityBlock } from "./types";

export function formatAvailability(mins: number): string {
  if (mins === 0) return "Rest";
  return formatDuration(mins * 60);
}

/** "18:00–19:30 · 1h 30m" for a timed block, "1h 30m" for a legacy one. */
export function formatBlock(b: AvailabilityBlock): string {
  const dur = formatAvailability(blockMins(b));
  if (b.start == null || b.end == null) return dur;
  return `${b.start}–${b.end} · ${dur}`;
}

export function formatBlocks(blocks: AvailabilityBlock[]): string {
  if (blocks.length === 0) return "Rest";
  return blocks.map(formatBlock).join(" + ");
}
