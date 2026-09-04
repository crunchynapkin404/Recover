import type { ScheduledWorkout } from "@/lib/week-plan/types";
import { fuellingFromSession } from "@/lib/fuelling/from-session";
import { fuellingSummary } from "@/lib/fuelling/summary";
import { DisclosureLink } from "@/components/ui/disclosure-link";

function range(r: { min: number; max: number }, unit: string): string {
  return `${r.min}-${r.max} ${unit}`;
}

function confidenceTone(confidence: "high" | "medium" | "low"): string {
  if (confidence === "high") return "text-chart-2 border-hairline";
  if (confidence === "medium") return "text-chart-3 border-hairline";
  return "text-ink-muted border-hairline";
}

/**
 * The one-line summary that replaces the open card on the Train page, plus
 * the ⓘ that links to the full detail. Renders nothing when the day has no
 * session — see fuellingSummary's own "two sessions count rather than
 * compete" note for why a single number can't stand in for two.
 */
export function FuellingLine({
  date,
  workouts,
  bodyMassKg,
  href,
}: {
  date: string;
  workouts: ScheduledWorkout[];
  bodyMassKg: number | null;
  href: string;
}) {
  const summary = fuellingSummary(workouts, bodyMassKg);
  if (!summary) return null;
  return (
    <div className="mb-4 flex items-center justify-between gap-2 px-1">
      <p className="truncate text-label text-ink-secondary">{summary}</p>
      <DisclosureLink href={href} label="Session fuelling detail" />
    </div>
  );
}

/**
 * The full per-session guidance, meant for the "Session fuelling" bottom
 * sheet — the sheet supplies its own title, so this renders only the body
 * that used to sit inside FuellingCard's <section>.
 */
export function FuellingDetail({
  date,
  workouts,
  bodyMassKg,
}: {
  date: string;
  workouts: ScheduledWorkout[];
  bodyMassKg: number | null;
}) {
  if (workouts.length === 0) return null;

  return (
    <div className="space-y-3">
      {workouts.map((w, idx) => {
        const guidance = fuellingFromSession(w, bodyMassKg);
        return (
          <article
            key={`${w.type}-${idx}`}
            className="rounded-[14px] bg-surface-overlay p-3"
          >
            <div className="mb-2 flex items-center justify-between gap-2">
              <p className="truncate text-caption font-semibold text-ink-primary">
                {w.type} · {w.durationMins} min
              </p>
              <span
                className={`rounded-full border px-2 py-0.5 text-label font-bold uppercase tracking-wider ${confidenceTone(
                  guidance.confidence
                )}`}
              >
                {guidance.confidence}
              </span>
            </div>

            {/* Task 12 (Part C, "also separately owed"): the Before/
                During/After labels and this body copy pre-migration were
                85% and 75% white respectively — a genuine
                label/detail pair, both collapsed onto text-ink-secondary
                in v0.49's token migration. Per-pair override applied: the
                quieter half (body copy) moves to ink-muted; the labels
                below keep their own explicit text-ink-secondary, which is
                what restores the two-tier hierarchy. */}
            <div className="space-y-1.5 text-label text-ink-muted">
              <p>
                <span className="font-semibold text-ink-secondary">
                  Before:
                </span>{" "}
                {range(guidance.before.carbsG, "g carbs")} ·{" "}
                {guidance.before.note}
              </p>
              <p>
                <span className="font-semibold text-ink-secondary">
                  During:
                </span>{" "}
                {range(guidance.during.carbsPerHourG, "g carbs/h")} and{" "}
                {range(guidance.during.fluidMlPerHour, "ml fluid/h")}
              </p>
              <p>
                <span className="font-semibold text-ink-secondary">After:</span>{" "}
                {range(guidance.after.carbsG, "g carbs")} and{" "}
                {range(guidance.after.proteinG, "g protein")} ·{" "}
                {guidance.after.note}
              </p>
            </div>

            {guidance.assumptions.length > 0 && (
              <p className="mt-2 text-label text-ink-muted">
                Assumptions: {guidance.assumptions.join("; ")}
              </p>
            )}
          </article>
        );
      })}
    </div>
  );
}

/**
 * Compatibility shim for `src/app/train/page.tsx`, which still imports the
 * pre-split card directly. A later task wires FuellingLine/FuellingDetail
 * into the page's disclosure sheet and removes this; until then it keeps
 * `tsc --noEmit` and the page's current on-screen behavior green by
 * reassembling the section + heading this split dropped from FuellingDetail
 * around the unchanged detail body.
 */
export function FuellingCard({
  date,
  workouts,
  bodyMassKg,
}: {
  date: string;
  workouts: ScheduledWorkout[];
  bodyMassKg: number | null;
}) {
  if (workouts.length === 0) return null;

  return (
    <section className="glass mb-5 overflow-hidden rounded-[18px] p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-label font-bold uppercase tracking-[0.12em] text-ink-secondary">
          Session fuelling
        </h2>
        <span className="text-label text-ink-muted">{date}</span>
      </div>
      <FuellingDetail date={date} workouts={workouts} bodyMassKg={bodyMassKg} />
    </section>
  );
}
