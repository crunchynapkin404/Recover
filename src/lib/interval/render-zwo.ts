import type { LibraryWorkout, Step } from "./types";

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** `.zwo` writes fractions of FTP where the library holds percentages. */
function frac(pct: number): string {
  return String(pct / 100);
}

function element(s: Step): string {
  const cadence = s.rpm ? ` Cadence="${s.rpm}"` : "";
  if (s.ramp) {
    return `    <Ramp Duration="${s.secs}" PowerLow="${frac(s.lo)}" PowerHigh="${frac(s.hi)}"${cadence}/>`;
  }
  // A non-ramped range still has one steady target; Zwift takes a single
  // Power, so the midpoint is the honest reading of "hold 88-93%". This is
  // the ONE place a representation is lossy — intervals.icu receives the
  // range — and the spec records it rather than leaving it to be discovered.
  const p = s.lo === s.hi ? s.lo : (s.lo + s.hi) / 2;
  return `    <SteadyState Duration="${s.secs}" Power="${frac(p)}"${cadence}/>`;
}

/**
 * A complete Zwift workout document.
 *
 * REPEATS ARE UNROLLED rather than written as <IntervalsT>. That element
 * encodes exactly an on/off pair, so it cannot express a repeat whose body is
 * not two steps — and an over-under is authored as an unrolled body of six.
 * Flat elements are always correct, need no special case, and render
 * identically; the only cost is a longer file.
 */
export function renderZwo(w: LibraryWorkout): string {
  const steps: string[] = [];
  for (const b of w.blocks) {
    for (let i = 0; i < b.repeat; i++) {
      for (const s of b.steps) steps.push(element(s));
    }
  }
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    "<workout_file>",
    "  <author>Recover</author>",
    `  <name>${esc(w.name)}</name>`,
    `  <description>${esc(w.why)}</description>`,
    "  <sportType>bike</sportType>",
    "  <workout>",
    ...steps,
    "  </workout>",
    "</workout_file>",
  ].join("\n");
}
