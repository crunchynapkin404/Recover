import type { Block, Step } from "./types";

/**
 * Duration in the syntax's own vocabulary: `30s`, `10m`, `1m30s`, `1h30m`.
 * `get-workout-syntax.ts` lists an `X:YY` form too; one spelling is enough and
 * this is the one its own examples use.
 *
 * HOURS ARE NOT OPTIONAL above 60 minutes. That file defines `Xm` twice —
 * minutes, and "Meters (context-dependent, >200 = meters)" in the distance
 * table. A long ride's endurance body is its flex step and routinely passes
 * 200 minutes, so spelling it `210m` exports a 210-METRE step to every device
 * the athlete owns. Carrying hours keeps the minutes component under 60,
 * where the ambiguity cannot arise.
 */
function dur(secs: number): string {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  return (
    (h ? `${h}h` : "") + (m ? `${m}m` : "") + (s || (!h && !m) ? `${s}s` : "")
  );
}

function target(step: Step): string {
  const power = step.ramp
    ? `ramp ${step.lo}%-${step.hi}%`
    : step.lo === step.hi
      ? `${step.lo}%`
      : `${step.lo}-${step.hi}%`;
  return step.rpm ? `${power} ${step.rpm}rpm` : power;
}

/**
 * The text intervals.icu parses out of a WORKOUT event's `description`.
 *
 * Syntax authority is src/lib/tools/get-workout-syntax.ts, which ships the
 * specification verbatim over MCP. Two forms are easy to get wrong and are
 * asserted in the tests: a ramp carries `%` on BOTH numbers (`50%-65%`) while
 * a plain range carries it once (`88-93%`), and a section with repeat 1 takes
 * no suffix — there is no `1x` in the syntax.
 */
export function renderIcu(blocks: readonly Block[]): string {
  return blocks
    .map((b) => {
      const head = b.repeat > 1 ? `${b.name} ${b.repeat}x` : b.name;
      return [
        head,
        ...b.steps.map((s) => `- ${dur(s.secs)} ${target(s)}`),
      ].join("\n");
    })
    .join("\n\n");
}
