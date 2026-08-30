"use client";

import { useActionState, useState } from "react";
import { CheckCircle } from "lucide-react";
import { logActivity, type ActionResult } from "@/app/activity/log/actions";

function localYmd(d: Date): string {
  return d.toLocaleDateString("en-CA");
}

const SPORTS = [
  { emoji: "🚴", label: "Ride" },
  { emoji: "🏃", label: "Run" },
  { emoji: "🏊", label: "Swim" },
  { emoji: "🚶", label: "Walk" },
  { emoji: "💪", label: "Strength" },
  { emoji: "🧘", label: "Yoga" },
  { emoji: "⚽", label: "Other" },
] as const;

const INPUT_CLS =
  "w-full rounded-xl border border-hairline bg-surface-raised px-3 py-2 text-caption text-ink-primary outline-none placeholder:text-ink-muted focus:border-accent";

export function ActivityLogForm() {
  const [state, action, pending] = useActionState<
    ActionResult | null,
    FormData
  >(logActivity, null);

  const [selectedSport, setSelectedSport] = useState<string>("");

  return (
    <div className="space-y-6">
      <header className="mb-6 pt-8">
        <h2 className="text-heading font-bold tracking-tighter">
          Log Activity
        </h2>
        <p className="mt-1 text-label text-ink-secondary">
          Manually record a training session
        </p>
      </header>

      <form action={action} className="space-y-3">
        <input type="hidden" name="sport" value={selectedSport} />

        {/* Sport selector */}
        <div className="glass rounded-[2rem] p-6">
          <h3 className="label-micro mb-4">Sport</h3>
          <div
            className="flex flex-wrap gap-2"
            role="radiogroup"
            aria-label="Sport"
          >
            {SPORTS.map((s) => (
              <button
                key={s.label}
                type="button"
                role="radio"
                aria-checked={selectedSport === s.label}
                onClick={() =>
                  setSelectedSport(selectedSport === s.label ? "" : s.label)
                }
                className={`flex items-center gap-1.5 rounded-xl px-3 py-2 text-caption transition-[color,background-color,box-shadow] ${
                  selectedSport === s.label
                    ? "bg-accent/20 ring-2 ring-accent text-ink-primary"
                    : "bg-surface-selected text-ink-secondary hover:bg-surface-overlay"
                }`}
              >
                <span aria-hidden>{s.emoji}</span>
                <span>{s.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Details */}
        <div className="glass rounded-[2rem] p-6">
          <h3 className="label-micro mb-4">Details</h3>
          <div className="space-y-4">
            {/* Date */}
            <div>
              <label
                htmlFor="activity-date"
                className="mb-1 block text-label font-medium text-ink-secondary"
              >
                Date
              </label>
              <input
                id="activity-date"
                type="date"
                name="date"
                defaultValue={localYmd(new Date())}
                className={INPUT_CLS}
              />
            </div>

            {/* Name */}
            <div>
              <label
                htmlFor="activity-name"
                className="mb-1 block text-label font-medium text-ink-secondary"
              >
                Name (optional)
              </label>
              <input
                id="activity-name"
                type="text"
                name="name"
                placeholder="Morning ride"
                className={INPUT_CLS}
              />
            </div>

            {/* Numeric inputs — 2-column grid */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label
                  htmlFor="activity-duration"
                  className="mb-1 block text-label font-medium text-ink-secondary"
                >
                  Duration (min)
                </label>
                <input
                  id="activity-duration"
                  type="number"
                  name="durationMinutes"
                  placeholder="60"
                  min="0"
                  max="1440"
                  step="1"
                  className={INPUT_CLS}
                />
              </div>
              <div>
                <label
                  htmlFor="activity-distance"
                  className="mb-1 block text-label font-medium text-ink-secondary"
                >
                  Distance (km)
                </label>
                <input
                  id="activity-distance"
                  type="number"
                  name="distanceKm"
                  placeholder="40"
                  min="0"
                  max="1000"
                  step="0.1"
                  className={INPUT_CLS}
                />
              </div>

              <div>
                <label
                  htmlFor="activity-hr"
                  className="mb-1 block text-label font-medium text-ink-secondary"
                >
                  Avg HR (bpm)
                </label>
                <input
                  id="activity-hr"
                  type="number"
                  name="avgHr"
                  placeholder="145"
                  min="20"
                  max="250"
                  step="1"
                  className={INPUT_CLS}
                />
              </div>
              <div>
                <label
                  htmlFor="activity-power"
                  className="mb-1 block text-label font-medium text-ink-secondary"
                >
                  Avg Power (W)
                </label>
                <input
                  id="activity-power"
                  type="number"
                  name="avgPower"
                  placeholder="200"
                  min="0"
                  max="2000"
                  step="1"
                  className={INPUT_CLS}
                />
              </div>

              <div>
                <label
                  htmlFor="activity-elevation"
                  className="mb-1 block text-label font-medium text-ink-secondary"
                >
                  Elevation (m)
                </label>
                <input
                  id="activity-elevation"
                  type="number"
                  name="elevationM"
                  placeholder="500"
                  min="0"
                  max="20000"
                  step="1"
                  className={INPUT_CLS}
                />
              </div>
              <div>
                <label
                  htmlFor="activity-load"
                  className="mb-1 block text-label font-medium text-ink-secondary"
                >
                  Training Load
                </label>
                <input
                  id="activity-load"
                  type="number"
                  name="load"
                  placeholder="80"
                  min="0"
                  max="999"
                  step="1"
                  className={INPUT_CLS}
                />
              </div>
            </div>
          </div>
        </div>

        {/* Status message */}
        {state && (
          <div
            className={`flex items-center gap-2 rounded-xl px-4 py-2 text-caption ${
              state.ok
                ? "bg-success-tint text-success-ink"
                : "bg-destructive-tint text-destructive-ink"
            }`}
          >
            {state.ok && <CheckCircle className="size-4" />}
            {state.message}
          </div>
        )}

        {/* Submit */}
        <button
          type="submit"
          disabled={pending}
          className="flex w-full items-center justify-center gap-2 rounded-2xl bg-accent px-6 py-3 font-bold text-accent-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {pending ? "Saving…" : "Log Activity"}
        </button>
      </form>
    </div>
  );
}
