import Link from "next/link";

type BaseProps = {
  /** The button's (or link's) visible text and accessible name. */
  label: string;
  /**
   * Which scrolling context this instance clears — see the file doc
   * comment below for the full reasoning behind each value. Defaults to
   * "page": every caller before task 4's fix pass rendered directly on
   * the page, and `IntakeForm`'s own call site is the one that now needs
   * to say "sheet" explicitly.
   */
  variant?: "page" | "sheet";
};

type SubmitProps = BaseProps & {
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
  href?: undefined;
};

type LinkProps = BaseProps & {
  /**
   * A plain navigation target, for the one shape of pinned primary action
   * that isn't a submit: the spec's own pinned-label list includes "Set
   * next week's availability" alongside "Confirm week"/"Plan this week",
   * and that one is pure navigation, not a form. Review finding 1 (task 4
   * fix pass): with `IntakeForm` moved into the "availability" sheet, the
   * page itself has no submit-shaped fields left to pin a button to — but
   * the spec never required the pinned slot to submit anything, only to
   * be reachable. Renders a real `<Link>`, never a bare `<button>` that
   * only LOOKS like navigation.
   */
  href: string;
  formAction?: undefined;
  pending?: undefined;
};

export type PinnedActionProps = SubmitProps | LinkProps;

/**
 * The week's one primary action, pinned so it survives scrolling a long
 * card instead of waiting at the bottom of it. `sticky`, not `fixed`: it
 * only floats once its own container's box would otherwise scroll it out
 * of view, and it returns to the document flow with the rest of that
 * container once the athlete scrolls past it entirely — it never floats
 * over unrelated content above or below the container that hosts it.
 *
 * TWO SCROLLING CONTEXTS, TWO OFFSETS (`variant`).
 *
 * `variant="page"` (default) — `bottom-32` (128px) is a measured value,
 * not the guess this task started with — see pinned-action.test.tsx and
 * the Task 6 report for how BottomNav's real footprint at 390x844 was
 * measured and why bottom-20 (the original guess) would have sat this
 * button under it.
 *
 * M2, final whole-branch review: that 128px was unconditional, but
 * BottomNav is `lg:hidden` and AppShell itself drops its own matching
 * clearance to `lg:pb-0` — on desktop there is nothing at the bottom of
 * the viewport to clear, so this band floated 128px above empty space.
 * `lg:bottom-6` follows the same mobile-vs-desktop split
 * chat-interface.tsx already uses for its own bottom-docked bar (a big
 * safe-area-aware pad on mobile, `lg:pb-6` on desktop) rather than
 * inventing a new number for the same "there's no nav to clear" case.
 *
 * `variant="sheet"` — review finding 4 (task 4 fix pass), the first time
 * this component has ever rendered nested inside a `WeekSheet`
 * (`IntakeForm`'s own "Confirm week", now that `IntakeForm` lives in the
 * "availability" sheet). `bottom-32` is wrong there on two counts at
 * once: it was measured to clear `BottomNav`, but `BottomNav` sits BEHIND
 * the sheet's own scrim (`bottom-nav.tsx`'s `z-50` vs `bottom-sheet.tsx`'s
 * `z-[60]`) — nothing to clear — and this instance's nearest scrolling
 * ancestor isn't the page at all, it's the sheet panel itself
 * (`overflow-y: auto`, `max-height: 92svh`), so a page-relative offset is
 * measuring the wrong box regardless.
 *
 * M2, final whole-branch review: this used to be `bottom-0`, and that was
 * wrong on its own terms, not merely unmeasured — the "REASONED, NOT
 * MEASURED" caveat below named the risk without naming the actual bug. A
 * `position: sticky` offset resolves against its scrolling ancestor's
 * PADDING box, not its content box. The panel's own bottom padding is
 * `calc(env(safe-area-inset-bottom)+1.25rem)` (bottom-sheet.tsx's
 * `sheet-panel`), there specifically to keep content clear of a notched
 * phone's home indicator — `bottom-0` stuck this button flush to THAT
 * padding-box edge, i.e. as low as the safe area's own outer edge, past
 * the padding meant to protect it, landing the sheet's own "Confirm week"
 * under the home indicator. Repeating the panel's exact padding value
 * here as the offset instead pulls the stuck position back up by that
 * same amount, so it rests at the content-box edge — where it would sit
 * in ordinary, non-sticky flow once the panel is scrolled all the way
 * down — clearing the safe area rather than sticking past it.
 */
export function PinnedAction(props: PinnedActionProps) {
  const { label, variant = "page" } = props;
  const offset =
    variant === "sheet"
      ? "bottom-[calc(env(safe-area-inset-bottom)+1.25rem)]"
      : "bottom-32 lg:bottom-6";
  return (
    <div
      data-pinned-action
      className={`sticky ${offset} z-30 bg-surface-base/95 pb-1 pt-3 backdrop-blur`}
    >
      {props.href !== undefined ? (
        <Link
          href={props.href}
          className="block w-full rounded-2xl bg-accent py-3 text-center text-caption font-bold text-primary-foreground transition-opacity hover:opacity-90"
        >
          {label}
        </Link>
      ) : (
        <button
          type="submit"
          formAction={props.formAction}
          disabled={props.pending}
          className="w-full rounded-2xl bg-accent py-3 text-caption font-bold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {label}
        </button>
      )}
    </div>
  );
}
