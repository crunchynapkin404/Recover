/**
 * The one way this app says "your tap registered and work is happening".
 *
 * STYLING-AGNOSTIC ON PURPOSE. It renders a bare `<button>` and passes
 * `className` straight through, because only 4 of the 26 components that run
 * a transition use the `Button` primitive — the other 20 are raw buttons with
 * their own class strings. A `pending` prop on `Button` would have reached
 * four of them, and reaching the rest would have meant restyling twenty
 * surfaces, which is the visual redesign this strand's non-goals forbid. This
 * owns semantics and nothing else, so all of them adopt it without a pixel
 * moving.
 *
 * WHAT IT OWNS, and why each part:
 *   - `disabled`, which every call site already did.
 *   - `aria-busy`, which NONE did. A screen-reader athlete previously got a
 *     button that simply went quiet, indistinguishable from one that had
 *     ignored the tap.
 *   - the label, which was spoken three ways: nothing at all
 *     (mark-done-button, day-actions), a bare "…" (strava-card), or "Saving…"
 *     (races-section, checkin-sheet).
 *
 * THE TYPES MAKE SILENCE UNREACHABLE. With a plain-string label the ellipsis
 * is free; with richer children — an icon beside text — `pendingLabel` is
 * required, so a call site cannot end up saying nothing by omission, which is
 * how two of them ended up saying nothing in the first place.
 */
type Base = Omit<React.ComponentProps<"button">, "children"> & {
  pending: boolean;
};

export type PendingButtonProps = Base &
  (
    | { children: string; pendingLabel?: React.ReactNode }
    | { children: React.ReactNode; pendingLabel: React.ReactNode }
  );

export function PendingButton({
  pending,
  pendingLabel,
  children,
  disabled,
  ...props
}: PendingButtonProps) {
  return (
    <button
      {...props}
      // A caller's own `disabled` is a separate reason (an invalid form, a
      // missing target); pending adds to it rather than replacing it.
      disabled={disabled || pending}
      aria-busy={pending || undefined}
    >
      {pending ? (pendingLabel ?? `${children as string}…`) : children}
    </button>
  );
}
