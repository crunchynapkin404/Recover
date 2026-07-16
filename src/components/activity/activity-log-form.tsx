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
  "w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none placeholder:text-white/30 focus:border-emerald-400/50";

export function ActivityLogForm() {
  const [state, action, pending] = useActionState<
    ActionResult | null,
    FormData
  >(logActivity, null);

  const [selectedSport, setSelectedSport] = useState<string>("");

  return (
    <div className="space-y-6">
      <header className="mb-6 pt-8">
        <h2 className="text-2xl font-bold tracking-tighter">Log Activity</h2>
        <p className="mt-1 text-xs text-white/50">
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
                className={`flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm transition-all ${
                  selectedSport === s.label
                    ? "bg-emerald-500/20 ring-2 ring-emerald-500 text-white"
                    : "bg-white/5 text-white/60 hover:bg-white/10"
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
                className="mb-1 block text-xs font-medium text-white/60"
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
                className="mb-1 block text-xs font-medium text-white/60"
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
                  className="mb-1 block text-xs font-medium text-white/60"
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
                  className="mb-1 block text-xs font-medium text-white/60"
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
                  className="mb-1 block text-xs font-medium text-white/60"
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
                  className="mb-1 block text-xs font-medium text-white/60"
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
                  className="mb-1 block text-xs font-medium text-white/60"
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
                  className="mb-1 block text-xs font-medium text-white/60"
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
            className={`flex items-center gap-2 rounded-xl px-4 py-2 text-sm ${
              state.ok
                ? "bg-emerald-500/10 text-emerald-400"
                : "bg-red-500/10 text-red-400"
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
          className="flex w-full items-center justify-center gap-2 rounded-2xl bg-emerald-500 px-6 py-3 font-bold text-black transition-all hover:bg-emerald-400 disabled:opacity-50"
        >
          {pending ? "Saving…" : "Log Activity"}
        </button>
      </form>
    </div>
  );
}
