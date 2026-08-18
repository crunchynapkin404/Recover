"use client";

import { useState, useTransition } from "react";
import {
  applyPlanChange,
  previewPlanChange,
  zeroDay,
} from "@/app/plan/actions";
import { unavailableMessage } from "@/components/ui/unavailable";

export interface DayActionsDay {
  date: string;
  workoutCount: number;
}

export interface DayActionsOtherDay {
  date: string;
  workoutCount: number;
  isRace: boolean;
}

interface Props {
  day: DayActionsDay;
  otherDays: DayActionsOtherDay[];
  /**
   * Drops the component's own divider and top margin, for callers that
   * already lay the actions out in a row of their own (Today's session card
   * sits "Mark done" next to them).
   */
  bare?: boolean;
}

type Action = "move" | "swap" | "skip";

// moveWorkout/swapWorkouts (src/lib/week-plan/service.ts) and
// previewPlanChange/applyPlanChange (src/app/plan/actions.ts) return raw
// codes on failure — never show those verbatim, translate them here (same
// idea as races-section.tsx's past_date handling).
const PLAN_ERROR_MESSAGES: Record<string, string> = {
  invalid:
    "That move isn't allowed — a day involved may already hold two sessions, or the target day may be taken, unavailable, or too close to another hard session.",
  no_open_week: "No open week to change right now.",
};

export function friendlyPlanError(code: string | null | undefined): string {
  if (!code) return "Could not apply the change.";
  return PLAN_ERROR_MESSAGES[code] ?? "Could not apply the change.";
}

/** "2026-07-24" → "Fri" — target days are always inside the open week. */
function dayName(ymd: string): string {
  return new Date(ymd + "T00:00:00").toLocaleDateString("en-US", {
    weekday: "short",
  });
}

type Preview =
  | { available: false; needs: string | null; loadDelta: number | null }
  | {
      available: true;
      anchorRace: string | null;
      beforeTsb: number;
      afterTsb: number;
      afterBand: string;
      loadDelta: number;
      capped: boolean;
      why?: string;
    };

// Fallback for the rare case `why` is absent on a capped projection (Figure's
// `why` is optional at the type level, even though raceCard()/simulateRaceForm()
// always supply one today) — the caveat must never silently vanish because a
// second field happened to be absent. That was this release's own headline bug.
const CAPPED_FALLBACK_WHY =
  "Projection ends at plan end, before race day — it is not a race-day figure.";

/**
 * Move/swap/skip a day's workout with a projected-form preview before
 * committing. Race days never carry a workout (materializeWeek clears it),
 * so this renders nothing for them — same guard as "no workout, no
 * actions".
 */
export function DayActions({ day, otherDays, bare = false }: Props) {
  const [pending, startTransition] = useTransition();
  const [action, setAction] = useState<Action>("move");
  const [target, setTarget] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [applied, setApplied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (day.workoutCount === 0) return null;

  const targets =
    action === "move"
      ? otherDays.filter((d) => d.workoutCount === 0 && !d.isRace)
      : action === "swap"
        ? otherDays.filter((d) => d.workoutCount > 0 && !d.isRace)
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
      setPreview(
        result.available
          ? {
              available: true,
              anchorRace: result.anchorRace,
              beforeTsb: result.beforeTsb,
              afterTsb: result.afterTsb,
              afterBand: result.afterBand,
              loadDelta: result.loadDelta,
              capped: result.capped,
              why: result.why,
            }
          : {
              available: false,
              needs: result.needs,
              loadDelta: result.loadDelta,
            }
      );
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
    <div className={bare ? "contents" : "mt-3 border-t border-hairline pt-3"}>
      {applied ? (
        <p className="text-label font-bold text-chart-2">
          {action === "move" ? "Moved." : "Swapped."}
        </p>
      ) : preview ? (
        <div className="space-y-2">
          {!preview.available ? (
            <p className="text-label text-ink-muted">
              {unavailableMessage({
                kind: "missing_input",
                needs: preview.needs ?? "more training history to project form",
              })}
            </p>
          ) : (
            <>
              <p className="text-label text-ink-secondary">
                {`${preview.anchorRace ? "Race-day form" : "Week-end form"}: ${preview.beforeTsb} → ${preview.afterTsb} TSB (${preview.afterBand})`}
              </p>
              {preview.capped && (
                <p className="text-label text-ink-muted">
                  {preview.why ?? CAPPED_FALLBACK_WHY}
                </p>
              )}
            </>
          )}
          {action === "skip" &&
            preview.loadDelta !== null &&
            preview.loadDelta !== 0 && (
              <p className="text-label text-ink-muted">
                {`Load change: ${preview.loadDelta}`}
              </p>
            )}
          <div className="flex gap-2">
            {action !== "skip" && (
              <button
                type="button"
                disabled={pending}
                onClick={confirmApply}
                className="rounded-lg bg-accent px-3 py-1 text-label font-bold text-primary-foreground disabled:opacity-50"
              >
                Confirm
              </button>
            )}
            <button
              type="button"
              onClick={resetPreview}
              className="rounded-lg border border-hairline px-3 py-1 text-label font-bold text-ink-secondary"
            >
              {action === "skip" ? "Close" : "Cancel"}
            </button>
          </div>
          {error && <p className="text-label text-chart-5">{error}</p>}
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={action}
            aria-label="Plan change"
            onChange={(e) => changeAction(e.target.value as Action)}
            className="rounded-full border border-hairline px-3 py-1 text-label font-bold text-ink-secondary focus:border-accent focus:outline-none"
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
              className="rounded-full border border-hairline px-3 py-1 text-label text-ink-secondary focus:border-accent focus:outline-none"
            >
              <option value="">Target day…</option>
              {targets.map((t) => (
                <option key={t.date} value={t.date}>
                  {dayName(t.date)}
                </option>
              ))}
            </select>
          )}
          {/* The projection *is* the mockup's violet "What if?" — same
              previewPlanChange call, named for what it answers. */}
          <button
            type="button"
            disabled={pending || (needsTarget && target === "")}
            onClick={runPreview}
            className="rounded-full border px-3 py-1 text-label font-bold disabled:opacity-40"
            // color was the literal #a78bfa, which IS dark's --coach-ink — the
            // token hardcoded. Referencing it instead leaves dark unmoved and
            // fixes light, where the literal measured 2.52:1 on --surface-base.
            // It only became a failure when v0.111.0 lifted `forcedTheme` and
            // renderableThemes() widened the guard to both themes; the tint and
            // border stay literals because they carry no text.
            style={{
              background: "rgba(139,92,246,0.1)",
              borderColor: "rgba(139,92,246,0.3)",
              color: "var(--coach-ink)",
            }}
          >
            What if?
          </button>
          {/* Pins this date to zero — an override, so it survives any later
              change to the standard week (that is the whole point). */}
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                const r = await zeroDay(day.date);
                if (!r.ok) setError(friendlyPlanError(r.error));
              })
            }
            className="rounded-full border border-hairline px-3 py-1 text-label font-bold text-ink-secondary disabled:opacity-40"
          >
            No time today
          </button>
          {error && <span className="text-label text-chart-5">{error}</span>}
        </div>
      )}
    </div>
  );
}
