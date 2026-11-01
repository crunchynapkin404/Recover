/**
 * The failure line under a Plan setup switch. Rendered empty before any
 * press rather than mounted with its text: screen readers announce a change
 * inside an existing live region reliably, a region inserted together with
 * its content not always.
 *
 * Sits outside the buttons and is not referenced by them, so each button's
 * accessible name stays exactly its visible text (Label in Name, v0.141.0).
 */
export function QuickActionError({
  error,
  subject,
}: {
  error: string | null;
  subject: string;
}) {
  return (
    <p
      role="alert"
      className={error ? "mt-1 px-2 text-caption text-destructive-ink" : ""}
    >
      {error ? quickActionMessage(subject, error) : ""}
    </p>
  );
}

/**
 * Every failure these actions return happens before anything is written, so
 * "Nothing was changed" is true for all of them.
 */
export function quickActionMessage(subject: string, error: string): string {
  if (error === "no_active_plan") {
    return "There's no active plan to change. Nothing was changed.";
  }
  return `Couldn't change the ${subject}. Nothing was changed — try again.`;
}
