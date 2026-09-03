export interface DayLogScore {
  label: string;
  value: number;
}

export interface DayLogProps {
  /** Only the scores the athlete actually logged. A zero is a real answer. */
  scores: DayLogScore[];
  tags: string[];
  notes: string | null;
  /** "Endurance Spin — RPE 6 · felt normal", or null when nothing was debriefed. */
  debriefLine: string | null;
}

/**
 * The evening lead block (v0.99 slice 1): the day as the athlete recorded
 * it, with the ride debrief folded in beside it. Every value is one the
 * check-in sheet and the debrief already store — this block moves them onto
 * Today at the moment they answer the question the athlete is asking, and
 * derives nothing.
 *
 * Renders nothing when there is nothing logged, so the caller can place it
 * unconditionally and an unlogged evening simply leads with the next block.
 */
export function DayLogCard({ scores, tags, notes, debriefLine }: DayLogProps) {
  const hasDebrief = debriefLine != null && debriefLine.trim() !== "";
  const empty =
    scores.length === 0 &&
    tags.length === 0 &&
    (notes == null || notes.trim() === "") &&
    !hasDebrief;
  if (empty) return null;

  return (
    <section className="rounded-[20px] glass glass-no-hover p-4">
      <p className="text-label font-bold uppercase tracking-[0.14em] text-ink-muted">
        Today&apos;s log
      </p>

      {/* One line, not three tiles. These shipped as bordered boxes with
          title-size numerals — the tallest block on Today, for three small
          numbers the athlete typed themselves. They summarise the day; they
          are not its headline, and the readiness ring above already is. */}
      {scores.length > 0 && (
        <p className="mt-1.5 text-caption text-ink-secondary">
          {scores.map((s, i) => (
            <span key={s.label}>
              {i > 0 && " · "}
              {s.label}{" "}
              <span className="font-numeric font-bold text-ink-primary">
                {s.value}
              </span>
            </span>
          ))}
        </p>
      )}

      {tags.length > 0 && (
        <p className="mt-3 text-caption text-ink-secondary">
          {tags.join(" · ")}
        </p>
      )}

      {notes != null && notes.trim() !== "" && (
        <p className="mt-2 text-caption italic leading-snug text-ink-secondary">
          &ldquo;{notes}&rdquo;
        </p>
      )}

      {hasDebrief && (
        <p className="mt-3 border-t border-hairline pt-3 text-label font-bold text-chart-2">
          {debriefLine}
        </p>
      )}
    </section>
  );
}
