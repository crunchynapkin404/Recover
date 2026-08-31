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
import { Fragment, useState, useTransition } from "react";
import { PendingButton } from "@/components/ui/pending-button";
import { SPORT_LABEL } from "@/lib/plan-sport";
import {
  REFUSAL_TEXT,
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

// One sentence each, in the register of `WARNING_TEXT`: state the fact, then
// what to do about it. Both buttons discard nothing silently — a stale draft
// (replaced from another tab, or by a new coach proposal) and a failed
// request are the two ways these actions come back without having done what
// the athlete asked, and each gets its own honest sentence rather than a
// swallowed promise.
const DRAFT_STALE_TEXT =
  "This proposal is no longer current, so ask your coach for a fresh one.";
const ACTION_FAILED_TEXT =
  "That didn't go through and nothing has changed, so try again in a moment.";
// Finding 1 (final review): the race this draft targets has since changed
// sport (via upsert_race), so the plan the athlete reviewed no longer
// matches it. confirmTrainingPlan refuses rather than activating it.
const SPORT_CHANGED_TEXT =
  "The race this plan targets has since changed sport, so this plan no longer matches it. Ask your coach for a fresh plan.";

export function PlanPreviewCard({
  preview,
  /**
   * Which surface this instance sits on, `PinnedAction`'s own `variant`
   * pattern (src/components/week/pinned-action.tsx): the two call sites
   * are NOT interchangeable, and this component is the only one of the
   * nine that gained the `bg-surface-selected` fix in this slice that
   * actually renders in both places (every other one is sheet-only).
   *
   * `"page"` (default) — the no-plan branch (train/page.tsx's `!plan`
   * early return), which has no sheet machinery at all (see that call
   * site's own comment) and renders directly on the page, on
   * `--surface-base`. `.glass` (`--surface-raised`) is the right ground
   * there, the same one every other page-level card uses.
   *
   * `"sheet"` — the "plan-review" sheet, whose panel is
   * `bg-surface-overlay`. `.glass` collides there (`--surface-raised` ==
   * `--surface-overlay` in light, both #ffffff) — `border-hairline
   * bg-surface-selected` is the fix, THE SAME RULE the other eight
   * sheet-only components already follow.
   *
   * THE RULE THIS ENCODES: `bg-surface-selected` is safe only inside a
   * `--surface-raised`/`--surface-overlay` container, never directly on
   * the page — `--surface-selected` equals `--surface-base` in BOTH
   * themes (deliberately: see globals.css's own comment on it), so on
   * the page it is not a subtle recolour, it is no ground at all.
   */
  variant = "page",
}: {
  preview: PlanPreview;
  variant?: "page" | "sheet";
}) {
  // Review finding 3, task 5's fix pass: dismissing the "plan-review"
  // sheet (Escape, backdrop, swipe) unmounts this component and drops
  // whatever days/hours the athlete had adjusted but not yet applied via
  // Rebuild. The LIKELY cause of an accidental dismiss — a scroll gesture
  // on this ~1.5-screen card doubling as bottom-sheet.tsx's own drag
  // gesture — is fixed at the shell (a drag no longer begins until the
  // panel is scrolled to its own top), so the remaining way to lose this
  // state is a DELIBERATE dismiss before pressing Rebuild. That is not
  // this component's own bug to fix further: `days`/`hours` are draft
  // ADJUSTMENTS to a value Rebuild applies, not a value anything has
  // committed yet, the same as closing any form with unsubmitted input —
  // IntakeForm's own fields behind the "availability" sheet are lost the
  // same way on the same dismiss paths, and nothing in this app persists
  // an in-progress, un-submitted numeric input across a deliberate close.
  const [days, setDays] = useState(preview.daysPerWeek);
  const [hours, setHours] = useState(preview.hoursPerWeek);
  const [pending, startTransition] = useTransition();
  // Rebuild and Start share one transition flag; without a name both would
  // announce themselves while one works.
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // Recomputed on screen, not trusted from `weeksTotal` alone — the release's
  // headline requirement is that this number and `weeksTotal` visibly agree.
  const total = preview.phases.reduce((sum, row) => sum + row.weeks, 0);

  // A single-race plan is entirely segment 1 (buildPhases), so this is false
  // — and the header row below never renders — on every plan this release
  // did not change. `preview` carries no identity for the first arc's race
  // beyond its place in the calendar (the draft row only names the FINAL
  // target by id/name — see plan-targets.ts), so segment 1's header states
  // that fact rather than a race name it doesn't have.
  const hasTwoArcs = preview.phases.some((row) => row.segment === 2);

  // Both handlers capture what the action actually returned. A discarded
  // `{ ok: false }` is this release's own premise violated in a new place:
  // the athlete presses a button, nothing visibly changes, and they have no
  // idea whether it worked. On success the existing `revalidatePath("/train")`
  // inside the action re-renders the page with fresh props; on failure (or a
  // thrown rejection) this state is what tells the athlete so on screen.
  function handleRebuild() {
    setBusy("rebuild");
    startTransition(async () => {
      try {
        const result = await regeneratePreviewAction(
          preview.planId,
          days,
          hours
        );
        if (result.ok) {
          setActionError(null);
        } else if (result.reason === "not_found") {
          setActionError(DRAFT_STALE_TEXT);
        } else {
          setActionError(REFUSAL_TEXT[result.reason]);
        }
      } catch {
        setActionError(ACTION_FAILED_TEXT);
      } finally {
        // finally, not a trailing call: a thrown action would otherwise strand
        // its button in the pending label for the rest of the session.
        setBusy(null);
      }
    });
  }

  function handleConfirm() {
    setBusy("confirm");
    startTransition(async () => {
      try {
        const result = await confirmPlanAction(preview.planId);
        if (result.ok) {
          setActionError(null);
        } else if (result.reason === "sport_changed") {
          setActionError(SPORT_CHANGED_TEXT);
        } else {
          setActionError(DRAFT_STALE_TEXT);
        }
      } catch {
        setActionError(ACTION_FAILED_TEXT);
      } finally {
        // finally, not a trailing call: a thrown action would otherwise strand
        // its button in the pending label for the rest of the session.
        setBusy(null);
      }
    });
  }

  // See the `variant` doc comment above for the full reasoning. Computed
  // once, not inlined into the className template, so it is one obvious
  // place to check when the light-mode-collision guard test below fails.
  const surfaceClass =
    variant === "sheet"
      ? "border border-hairline bg-surface-selected"
      : "glass";

  return (
    <section className={`mb-4 rounded-[1.5rem] ${surfaceClass} p-5`}>
      <p className="label-micro mb-1">Plan preview</p>
      <h2 className="mb-1 text-body font-bold text-ink-primary">
        {SPORT_LABEL[preview.sport]} plan for {preview.race.name}
      </h2>
      <p className="mb-4 text-label text-ink-muted">
        {preview.weeksTotal} weeks · starting {preview.startDate} · race{" "}
        {preview.race.date}
      </p>

      {/* The arithmetic, visible. `periodize` substitutes recovery weeks
          INSIDE a phase's span, so "base, 8 weeks" and "eight base weeks"
          are different numbers — recovery gets its own row and the total is
          shown so the two can be checked against each other on screen. */}
      <table className="mb-4 w-full text-label">
        <tbody>
          {preview.phases.map((row, i) => {
            const prev = preview.phases[i - 1];
            // Only a two-arc plan gets a header at all, and only once per
            // arc (on the row where `segment` changes from the previous
            // one) — a single-race plan's rows are all segment 1, so
            // `showHeader` is false throughout and this table renders
            // byte-identically to before this arc existed.
            const showHeader = hasTwoArcs && row.segment !== prev?.segment;
            // Segment 1 is named after the race it builds to, the same way
            // segment 2 is. It fell back to the literal "First race" while
            // `PlanPreview` resolved identity for the final target only, and
            // that placeholder sitting directly above the second race's real
            // name read as unfinished on screen. The fallback stays for a
            // first race whose row was deleted underneath the draft.
            const segmentLabel =
              row.segment === 1
                ? (preview.firstRace?.name ?? "First race")
                : preview.race.name;
            return (
              <Fragment
                key={`${row.segment}-${row.phase}-${row.isBridge ? "b" : "o"}`}
              >
                {showHeader && (
                  <tr data-testid={`segment-${row.segment}`}>
                    <td
                      colSpan={3}
                      className="pt-3 pb-1 text-label text-ink-muted"
                    >
                      {segmentLabel}
                    </td>
                  </tr>
                )}
                <tr
                  data-testid={
                    row.isBridge
                      ? "phase-bridge"
                      : `phase-${row.segment}-${row.phase}`
                  }
                  className="border-b border-hairline"
                >
                  <td className="py-1.5 text-ink-secondary">
                    {/* The bridge is the whole point of a two-race plan and
                        was rendering as an ordinary "Recovery" row merged
                        with the arc's own easy weeks. Named, it is legible. */}
                    {row.isBridge
                      ? "Recovery between races"
                      : PHASE_LABEL[row.phase]}
                  </td>
                  <td className="py-1.5 text-right font-numeric text-ink-muted">
                    {row.weeks}
                  </td>
                  <td className="py-1.5 pl-3 text-ink-muted">
                    weeks {row.weekNumbers.join(", ")}
                  </td>
                </tr>
              </Fragment>
            );
          })}
          <tr>
            <td className="pt-2 text-label font-bold text-ink-secondary">
              Total
            </td>
            <td
              className="pt-2 text-right font-numeric font-bold text-ink-secondary"
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
            className="flex justify-between text-label text-ink-secondary"
          >
            <span>
              Week {w.weekNumber} · {PHASE_LABEL[w.phase]}
              {w.raceName ? ` · ${w.raceName}` : ""}
            </span>
            {/* The engine's own scheduled hours — never recomputed here. A
                week-1 ratio produced a fabricated 15.7h against 8.8h really
                scheduled at peak; rendering `targetHours` as given is what
                keeps that number honest. */}
            <span className="font-numeric">
              {w.targetLoad} load · {w.targetHours}h
            </span>
          </li>
        ))}
      </ul>

      {preview.warnings.length > 0 && (
        <ul className="mb-4 space-y-1.5">
          {preview.warnings.map((w) => (
            <li key={w} className="text-label leading-relaxed text-chart-3">
              {WARNING_TEXT[w]}
            </li>
          ))}
        </ul>
      )}

      {actionError && (
        <p
          data-testid="plan-preview-error"
          className="mb-4 text-label leading-relaxed text-chart-5"
        >
          {actionError}
        </p>
      )}

      <div className="flex flex-wrap items-end gap-3 border-t border-hairline pt-4">
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
            className="w-16 rounded-xl border border-hairline px-3 py-2 text-caption text-ink-primary"
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
            className="w-16 rounded-xl border border-hairline px-3 py-2 text-caption text-ink-primary"
          />
        </div>
        <PendingButton
          type="button"
          disabled={pending}
          pending={pending && busy === "rebuild"}
          pendingLabel="Rebuilding…"
          onClick={handleRebuild}
          className="rounded-full border border-hairline px-3.5 py-2 text-label font-bold text-ink-secondary transition-colors hover:bg-surface-overlay disabled:opacity-50"
        >
          Rebuild
        </PendingButton>
        <PendingButton
          type="button"
          disabled={pending}
          pending={pending && busy === "confirm"}
          pendingLabel="Starting…"
          onClick={handleConfirm}
          className="rounded-full bg-accent px-4 py-2 text-label font-bold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          Start this plan
        </PendingButton>
      </div>
    </section>
  );
}
