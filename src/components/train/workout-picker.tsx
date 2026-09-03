"use client";

import { useActionState, useMemo, useState } from "react";
import {
  pickWorkoutAction,
  type PickActionResult,
} from "@/app/train/pick-workout-actions";
import type { PickerWorkout } from "@/lib/interval/picker";
import { WorkoutProfile } from "./workout-profile";

/** How many rows carry the "Recommended today" marker. */
const RECOMMENDED_COUNT = 5;

const PURPOSE_LABEL: Record<string, string> = {
  recovery: "Recovery",
  aerobic_base: "Endurance",
  long: "Long",
  threshold: "Threshold",
  vo2max: "VO₂max",
};

/**
 * The library picker: every workout, ordered for this day.
 *
 * ALL 103 ROWS ARE PICKABLE. The recommended group is a MARKER on the first
 * rows of one list, not a separate screen with the library behind a second
 * tap — the athlete asked for the whole library, and a hidden "show
 * everything" control is the second-door shape docs/2026-08-26-ia-inventory.md
 * already flagged. Recover's opinion travels as the order, the marker and the
 * `recommendWhy` line.
 *
 * Warnings are rendered ON the pick rather than as a grey subtitle, because
 * the open library is the only thing standing between the athlete and a
 * wrecked taper, and a warning nobody reads is not one.
 */
export function WorkoutPicker({
  date,
  today,
  workouts,
  ftpWatts,
  warning,
}: {
  date: string;
  /** The athlete's local calendar day, resolved by the caller. */
  today: string;
  workouts: PickerWorkout[];
  /** Absent when the athlete has never set one — targets then stay in %FTP. */
  ftpWatts: number | null;
  /** Recover's disagreement with adding anything here at all, if it has one. */
  warning: string | null;
}) {
  const [purpose, setPurpose] = useState<string>("all");
  const [family, setFamily] = useState<string>("all");
  const [maxMins, setMaxMins] = useState<number>(0);
  const [openId, setOpenId] = useState<string | null>(null);
  const [state, action, pending] = useActionState<
    PickActionResult | null,
    FormData
  >(pickWorkoutAction, null);

  const families = useMemo(
    () => [...new Set(workouts.map((w) => w.family))].sort(),
    [workouts]
  );

  const shown = useMemo(
    () =>
      workouts.filter(
        (w) =>
          (purpose === "all" || w.purpose === purpose) &&
          (family === "all" || w.family === family) &&
          (maxMins === 0 || w.minMins <= maxMins)
      ),
    [workouts, purpose, family, maxMins]
  );

  return (
    // The capture hook. scripts/verify-surfaces.ts refuses to file
    // `train-pick-workout` without it rather than photographing the
    // ordinary Train tab under a second name.
    <div data-workout-picker className="flex flex-col gap-3">
      {warning && (
        <p
          className="rounded-md border border-ink-race/40 bg-ink-race/10 px-3 py-2 text-caption text-ink-race"
          role="status"
        >
          {warning}
        </p>
      )}

      {ftpWatts == null && (
        <p className="text-label text-ink-muted">
          Targets are shown as % of FTP. Set your FTP in Settings to see them in
          watts.
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <label className="sr-only" htmlFor="pick-purpose">
          Filter by purpose
        </label>
        <select
          id="pick-purpose"
          value={purpose}
          onChange={(e) => setPurpose(e.target.value)}
          className="rounded-md border border-ink-muted bg-surface-raised px-2 py-1 text-caption"
        >
          <option value="all">All purposes</option>
          {Object.entries(PURPOSE_LABEL).map(([k, label]) => (
            <option key={k} value={k}>
              {label}
            </option>
          ))}
        </select>

        <label className="sr-only" htmlFor="pick-family">
          Filter by family
        </label>
        <select
          id="pick-family"
          value={family}
          onChange={(e) => setFamily(e.target.value)}
          className="rounded-md border border-ink-muted bg-surface-raised px-2 py-1 text-caption"
        >
          <option value="all">All shapes</option>
          {families.map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </select>

        <label className="sr-only" htmlFor="pick-maxmins">
          Longest session
        </label>
        <select
          id="pick-maxmins"
          value={String(maxMins)}
          onChange={(e) => setMaxMins(Number(e.target.value))}
          className="rounded-md border border-ink-muted bg-surface-raised px-2 py-1 text-caption"
        >
          <option value="0">Any length</option>
          {[45, 60, 90, 120, 180].map((m) => (
            <option key={m} value={m}>
              Up to {m} min
            </option>
          ))}
        </select>
      </div>

      <p className="text-label text-ink-muted" aria-live="polite">
        {shown.length} of {workouts.length} workouts
      </p>

      {state && (
        <p
          className={`text-caption ${state.ok ? "text-chart-2" : "text-ink-race"}`}
          role="status"
        >
          {state.message}
        </p>
      )}

      <ul className="flex flex-col gap-2">
        {shown.map((w) => {
          const recommended = w.rank < RECOMMENDED_COUNT;
          const open = openId === w.id;
          return (
            <li
              key={w.id}
              className="rounded-lg border border-ink-muted bg-surface-raised p-3"
            >
              <button
                type="button"
                onClick={() => setOpenId(open ? null : w.id)}
                aria-expanded={open}
                className="flex w-full flex-col gap-1 text-left"
              >
                <span className="flex items-baseline justify-between gap-2">
                  <span className="text-body font-bold">{w.name}</span>
                  <span className="shrink-0 text-label text-ink-muted">
                    {PURPOSE_LABEL[w.purpose] ?? w.purpose}
                  </span>
                </span>
                {recommended && (
                  <span className="text-label font-bold text-chart-2">
                    Recommended today
                  </span>
                )}
                <WorkoutProfile bars={w.profile} label={w.description} />
                <span className="text-caption text-ink-muted">
                  {w.description}
                </span>
                <span className="text-label text-ink-muted">
                  {w.recommendWhy}
                </span>
              </button>

              {open && (
                <form action={action} className="mt-3 flex flex-col gap-2">
                  <input type="hidden" name="date" value={date} />
                  <input type="hidden" name="today" value={today} />
                  <input type="hidden" name="workoutId" value={w.id} />
                  <p className="text-caption text-ink-muted">{w.why}</p>
                  <label
                    className="text-label text-ink-muted"
                    htmlFor={`mins-${w.id}`}
                  >
                    Length ({w.minMins}–{w.maxMins} min)
                  </label>
                  <input
                    id={`mins-${w.id}`}
                    name="durationMins"
                    type="number"
                    min={w.minMins}
                    max={w.maxMins}
                    step={1}
                    defaultValue={w.defaultMins}
                    className="w-24 rounded-md border border-ink-muted bg-surface-raised px-2 py-1 text-caption"
                  />
                  <button
                    type="submit"
                    disabled={pending}
                    className="rounded-md bg-ink-primary px-3 py-2 text-caption font-bold text-surface-base disabled:opacity-50"
                  >
                    {pending ? "Adding…" : "Add to this day"}
                  </button>
                </form>
              )}
            </li>
          );
        })}
      </ul>

      {shown.length === 0 && (
        <p className="text-caption text-ink-muted">
          No workouts match those filters.
        </p>
      )}
    </div>
  );
}
