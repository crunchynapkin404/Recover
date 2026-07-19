"use client";

import { useState, useTransition } from "react";
import { applyPlanChange, previewPlanChange } from "@/app/plan/actions";

export interface DayActionsDay {
  date: string;
  hasWorkout: boolean;
}

export interface DayActionsOtherDay {
  date: string;
  hasWorkout: boolean;
  isRace: boolean;
}

interface Props {
  day: DayActionsDay;
  otherDays: DayActionsOtherDay[];
}

type Action = "move" | "swap" | "skip";

// moveWorkout/swapWorkouts (src/lib/week-plan/service.ts) and
// previewPlanChange/applyPlanChange (src/app/plan/actions.ts) return raw
// codes on failure — never show those verbatim, translate them here (same
// idea as races-section.tsx's past_date handling).
const PLAN_ERROR_MESSAGES: Record<string, string> = {
  invalid:
    "That move isn't allowed — the target day may already be taken, unavailable, or too close to another hard session.",
  no_open_week: "No open week to change right now.",
};

export function friendlyPlanError(code: string | null | undefined): string {
  if (!code) return "Could not apply the change.";
  return PLAN_ERROR_MESSAGES[code] ?? "Could not apply the change.";
}

interface Preview {
  insufficient: boolean;
  anchorRace: string | null;
  beforeTsb: number | null;
  afterTsb: number | null;
  afterBand: string | null;
  loadDelta: number;
}

/**
 * Move/swap/skip a day's workout with a projected-form preview before
 * committing. Race days never carry a workout (materializeWeek clears it),
 * so this renders nothing for them — same guard as "no workout, no
 * actions".
 */
export function DayActions({ day, otherDays }: Props) {
  const [pending, startTransition] = useTransition();
  const [action, setAction] = useState<Action>("move");
  const [target, setTarget] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [applied, setApplied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!day.hasWorkout) return null;

  const targets =
    action === "move"
      ? otherDays.filter((d) => !d.hasWorkout && !d.isRace)
      : action === "swap"
        ? otherDays.filter((d) => d.hasWorkout && !d.isRace)
        : [];
  const needsTarget = action !== "skip";

  function resetPreview() {
    setPreview(null);
    setApplied(false);
    setError(null);
  }

  function changeAction(next: Action) {
    setAction(next);
    setTarget("");
    resetPreview();
  }

  function runPreview() {
    setError(null);
    startTransition(async () => {
      const result = await previewPlanChange({
        action,
        fromDate: day.date,
        toDate: needsTarget ? target : undefined,
      });
      if (!result.ok) {
        setError(friendlyPlanError(result.error));
        return;
      }
      setPreview({
        insufficient: result.insufficient,
        anchorRace: result.anchorRace,
        beforeTsb: result.beforeTsb,
        afterTsb: result.afterTsb,
        afterBand: result.afterBand,
        loadDelta: result.loadDelta,
      });
    });
  }

  function confirmApply() {
    if (action === "skip") return;
    setError(null);
    startTransition(async () => {
      const result = await applyPlanChange({
        action,
        fromDate: day.date,
        toDate: target,
      });
      if (!result.ok) {
        setError(friendlyPlanError(result.error));
        return;
      }
      setApplied(true);
    });
  }

  return (
    <div className="mt-3 border-t border-white/5 pt-3">
      {applied ? (
        <p className="text-[11px] font-bold text-emerald-400">
          {action === "move" ? "Moved." : "Swapped."}
        </p>
      ) : preview ? (
        <div className="space-y-2">
          {preview.insufficient ? (
            <p className="text-[11px] text-white/50">
              No projection — calibrating.
            </p>
          ) : (
            <p className="text-[11px] text-white/70">
              {`${preview.anchorRace ? "Race-day form" : "Week-end form"}: ${preview.beforeTsb} → ${preview.afterTsb} TSB (${preview.afterBand})`}
            </p>
          )}
          {action === "skip" && preview.loadDelta !== 0 && (
            <p className="text-[10px] text-white/40">
              {`Load change: ${preview.loadDelta}`}
            </p>
          )}
          <div className="flex gap-2">
            {action !== "skip" && (
              <button
                type="button"
                disabled={pending}
                onClick={confirmApply}
                className="rounded-lg bg-emerald-500/90 px-3 py-1 text-[11px] font-bold text-neutral-950 disabled:opacity-50"
              >
                Confirm
              </button>
            )}
            <button
              type="button"
              onClick={resetPreview}
              className="rounded-lg bg-white/10 px-3 py-1 text-[11px] font-bold text-white/70"
            >
              {action === "skip" ? "Close" : "Cancel"}
            </button>
          </div>
          {error && <p className="text-[11px] text-red-400">{error}</p>}
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={action}
            aria-label="Plan change"
            onChange={(e) => changeAction(e.target.value as Action)}
            className="rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-[11px] text-white/70 focus:border-white/30 focus:outline-none"
          >
            <option value="move">Move</option>
            <option value="swap">Swap</option>
            <option value="skip">Skip</option>
          </select>
          {needsTarget && (
            <select
              value={target}
              aria-label="Target day"
              onChange={(e) => setTarget(e.target.value)}
              className="rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-[11px] text-white/70 focus:border-white/30 focus:outline-none"
            >
              <option value="">Target day…</option>
              {targets.map((t) => (
                <option key={t.date} value={t.date}>
                  {t.date}
                </option>
              ))}
            </select>
          )}
          <button
            type="button"
            disabled={pending || (needsTarget && target === "")}
            onClick={runPreview}
            className="rounded-lg bg-white/10 px-3 py-1 text-[11px] font-bold text-white/80 disabled:opacity-40"
          >
            Preview
          </button>
          {error && <span className="text-[11px] text-red-400">{error}</span>}
        </div>
      )}
    </div>
  );
}
