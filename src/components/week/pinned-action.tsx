interface Props {
  /** The button's visible text and accessible name. */
  label: string;
  /**
   * A React 19 form action — `(formData: FormData) => void | Promise<void>`.
   * Set as the BUTTON's own `formAction`, not a `<form action>` here: this
   * component renders no `<form>` of its own. It is meant to replace the
   * plain inline submit button at the end of an EXISTING form (IntakeForm's
   * `Confirm week`, the start-week form's `Plan this week`) in place, so a
   * click still collects that form's real fields — hidden day-by-day
   * inputs included — into the `FormData` the action receives. A form of
   * its own here would submit empty.
   */
  formAction: (formData: FormData) => void | Promise<void>;
  /** Disables the button while a submission from this action is in flight. */
  pending?: boolean;
}

/**
 * The week's one primary action, pinned so it survives scrolling a long
 * card instead of waiting at the bottom of it. `sticky`, not `fixed`: it
 * only floats once its own form's box would otherwise scroll it out of
 * view, and it returns to the document flow with the rest of that form
 * once the athlete scrolls past it entirely — it never floats over
 * unrelated content above or below the form that hosts it.
 *
 * `bottom-32` (128px) is a measured value, not the guess this task
 * started with — see pinned-action.test.tsx and the Task 6 report for how
 * BottomNav's real footprint at 390x844 was measured and why bottom-20
 * (the original guess) would have sat this button under it.
 */
export function PinnedAction({ label, formAction, pending = false }: Props) {
  return (
    <div
      data-pinned-action
      // `bottom-32` deliberately follows BottomNav's (src/components/
      // bottom-nav.tsx) flat, NON-safe-area convention rather than
      // `env(safe-area-inset-bottom)` (used by block-sheet.tsx, ui/
      // bottom-sheet.tsx, and the chat interface) — the 24px clearance
      // between this band and BottomNav's top edge stays safe-area-
      // independent precisely because both ignore it identically.
      className="sticky bottom-32 z-30 bg-surface-base/95 pb-1 pt-3 backdrop-blur"
    >
      <button
        type="submit"
        formAction={formAction}
        disabled={pending}
        className="w-full rounded-2xl bg-accent py-3 text-caption font-bold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
      >
        {label}
      </button>
    </div>
  );
}
