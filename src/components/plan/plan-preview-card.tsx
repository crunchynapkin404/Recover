"use client";

/**
 * The card on `/train` that shows a proposed plan before it becomes the
 * athlete's (v0.43, Task 8). `previewTrainingPlan` writes an inert `draft`
 * row and nothing else; this is the only place that draft is visible, and
 * `confirmPlanAction` below is the only thing that activates it.
 *
 * Three decisions, not four controls: Rebuild is not a third decision, it
 * applies the two number inputs above it. Periodization (phase lengths,
 * where recovery weeks land) is not exposed here at all — it gets the
 * table below, not a slider, because `periodize` is not a parameter this
 * screen lets the athlete tune.
 */
import { useState, useTransition } from "react";
import { SPORT_LABEL } from "@/lib/plan-sport";
import {
  WARNING_TEXT,
  type PlanPhase,
  type PlanPreview,
} from "@/lib/plan-preview";
import { confirmPlanAction, regeneratePreviewAction } from "@/app/plan/actions";

const PHASE_LABEL: Record<PlanPhase, string> = {
  base: "Base",
  build: "Build",
  peak: "Peak",
  taper: "Taper",
  recovery: "Recovery",
};

export function PlanPreviewCard({ preview }: { preview: PlanPreview }) {
  const [days, setDays] = useState(5);
  const [hours, setHours] = useState(8);
  const [pending, startTransition] = useTransition();

  // Recomputed on screen, not trusted from `weeksTotal` alone — the release's
  // headline requirement is that this number and `weeksTotal` visibly agree.
  const total = preview.phases.reduce((sum, row) => sum + row.weeks, 0);

  return (
    <section className="glass mb-4 rounded-[1.5rem] p-5">
      <p className="label-micro mb-1">Plan preview</p>
      <h2 className="mb-1 text-[15px] font-bold text-white/90">
        {SPORT_LABEL[preview.sport]} plan for {preview.race.name}
      </h2>
      <p className="mb-4 text-[11.5px] text-white/50">
        {preview.weeksTotal} weeks · starting {preview.startDate} · race{" "}
        {preview.race.date}
      </p>

      {/* The arithmetic, visible. `periodize` substitutes recovery weeks
          INSIDE a phase's span, so "base, 8 weeks" and "eight base weeks"
          are different numbers — recovery gets its own row and the total is
          shown so the two can be checked against each other on screen. */}
      <table className="mb-4 w-full text-[11.5px]">
        <tbody>
          {preview.phases.map((row) => (
            <tr
              key={row.phase}
              data-testid={`phase-${row.phase}`}
              className="border-b border-white/[0.06]"
            >
              <td className="py-1.5 text-white/80">{PHASE_LABEL[row.phase]}</td>
              <td className="py-1.5 text-right font-mono tabular-nums text-white/60">
                {row.weeks}
              </td>
              <td className="py-1.5 pl-3 text-white/40">
                weeks {row.weekNumbers.join(", ")}
              </td>
            </tr>
          ))}
          <tr>
            <td className="pt-2 text-[11.5px] font-bold text-white/85">
              Total
            </td>
            <td
              className="pt-2 text-right font-mono tabular-nums font-bold text-white/85"
              data-testid="phase-total"
            >
              {total}
            </td>
            <td />
          </tr>
        </tbody>
      </table>

      <ul className="mb-4 space-y-1">
        {preview.weeks.map((w) => (
          <li
            key={w.weekNumber}
            className="flex justify-between text-[11px] text-white/60"
          >
            <span>
              Week {w.weekNumber} · {PHASE_LABEL[w.phase]}
              {w.raceName ? ` · ${w.raceName}` : ""}
            </span>
            {/* The engine's own scheduled hours — never recomputed here. A
                week-1 ratio produced a fabricated 15.7h against 8.8h really
                scheduled at peak; rendering `targetHours` as given is what
                keeps that number honest. */}
            <span className="font-mono tabular-nums">
              {w.targetLoad} load · {w.targetHours}h
            </span>
          </li>
        ))}
      </ul>

      {preview.warnings.length > 0 && (
        <ul className="mb-4 space-y-1.5">
          {preview.warnings.map((w) => (
            <li
              key={w}
              className="text-[11px] leading-relaxed text-amber-300/90"
            >
              {WARNING_TEXT[w]}
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-end gap-3 border-t border-white/[0.08] pt-4">
        <div>
          <label className="label-micro mb-1 block" htmlFor="plan-preview-days">
            Days per week
          </label>
          <input
            id="plan-preview-days"
            aria-label="Days per week"
            type="number"
            min={3}
            max={7}
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
            className="w-16 rounded-xl bg-white/[0.06] px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label
            className="label-micro mb-1 block"
            htmlFor="plan-preview-hours"
          >
            Hours per week
          </label>
          <input
            id="plan-preview-hours"
            aria-label="Hours per week"
            type="number"
            min={3}
            max={25}
            value={hours}
            onChange={(e) => setHours(Number(e.target.value))}
            className="w-16 rounded-xl bg-white/[0.06] px-3 py-2 text-sm"
          />
        </div>
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              await regeneratePreviewAction(preview.planId, days, hours);
            })
          }
          className="rounded-full border border-white/[0.12] px-3.5 py-2 text-[11px] font-bold text-white/80 transition-colors hover:bg-white/[0.06] disabled:opacity-50"
        >
          Rebuild
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              await confirmPlanAction(preview.planId);
            })
          }
          className="rounded-full bg-emerald-500/90 px-4 py-2 text-[11px] font-bold text-neutral-950 transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          Start this plan
        </button>
      </div>
    </section>
  );
}
