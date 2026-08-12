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
  const empty =
    scores.length === 0 &&
    tags.length === 0 &&
    (notes == null || notes.trim() === "") &&
    debriefLine == null;
  if (empty) return null;

  return (
    <section className="rounded-[20px] border border-hairline bg-surface-raised p-4">
      <p className="text-label font-bold uppercase tracking-[0.14em] text-ink-muted">
        Today&apos;s log
      </p>

      {scores.length > 0 && (
        <div className="mt-3 grid grid-cols-3 gap-2">
          {scores.map((s) => (
            <div
              key={s.label}
              className="rounded-xl border border-hairline bg-surface-overlay px-3 py-2.5 text-center"
            >
              <p className="font-numeric text-title font-bold leading-none text-ink-primary">
                {s.value}
              </p>
              <p className="mt-1 text-label font-bold uppercase tracking-[0.14em] text-ink-muted">
                {s.label}
              </p>
            </div>
          ))}
        </div>
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

      {debriefLine && (
        <p className="mt-3 border-t border-hairline pt-3 text-label font-bold text-chart-2">
          {debriefLine}
        </p>
      )}
    </section>
  );
}
