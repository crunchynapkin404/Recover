import Link from "next/link";
import { sparkPath } from "@/lib/sparkline";
import { InlineMarkdown } from "@/components/ui/inline-markdown";

export interface JustLandedStat {
  label: string;
  value: string;
  unit?: string;
}

export interface JustLandedStream {
  label: string;
  /** Already a path — see downsample + sparkPath. "" is filtered by the caller. */
  path: string;
  /** Tailwind stroke utility, e.g. "stroke-chart-5". */
  className: string;
}

export interface JustLandedProps {
  activityId: string;
  name: string;
  /** "Cycling · Tue Aug 11 · intervals.icu" */
  meta: string;
  /** What the plan asked for, or null when this ride was unplanned. */
  asked: string | null;
  /** What the activity actually recorded. */
  delivered: string;
  stats: JustLandedStat[];
  debrief: {
    answer: string | null;
    notes: string | null;
    review: string | null;
  } | null;
  /** Empty when the stream cache is cold — the strip is then omitted. */
  streams: JustLandedStream[];
  lapCount: number | null;
}

/**
 * A ride stream is thousands of points. Handing one straight to sparkPath
 * emits a path string longer than the page, and spreads the whole array
 * into Math.min/Math.max, which throws RangeError past roughly 100k
 * arguments. Bucket first, average within the bucket, and keep a bucket
 * with no real readings honestly null.
 */
export function downsample(
  values: (number | null)[],
  buckets = 40
): (number | null)[] {
  if (values.length <= buckets) return values;
  const size = values.length / buckets;
  const out: (number | null)[] = [];
  for (let i = 0; i < buckets; i++) {
    const slice = values.slice(
      Math.floor(i * size),
      Math.floor((i + 1) * size)
    );
    const nums = slice.filter((v): v is number => v != null);
    out.push(
      nums.length > 0 ? nums.reduce((s, v) => s + v, 0) / nums.length : null
    );
  }
  return out;
}

/** Convenience for the page: stream values → a drawable path, or "". */
export function streamPath(values: (number | null)[] | undefined): string {
  if (!values || values.length === 0) return "";
  return sparkPath(downsample(values));
}

/**
 * The post-session lead block (v0.99 slice 1).
 *
 * The measured fix behind it: `/activity/[id]` was reachable only from a row
 * inside Train → History, and across four days containing four activities
 * the athlete opened it zero times. This surfaces the same route the moment
 * the data that makes it worth opening exists. Every figure here is one
 * `/activity/[id]` already renders — nothing is derived for this block, and
 * there is deliberately no verdict on the ride: the judgement the athlete
 * gets is the coach review, which has an owner.
 */
export function JustLandedCard({
  activityId,
  name,
  meta,
  asked,
  delivered,
  stats,
  debrief,
  streams,
  lapCount,
}: JustLandedProps) {
  return (
    <section className="rounded-[20px] border border-hairline bg-surface-raised p-4">
      <p className="text-label font-bold uppercase tracking-[0.14em] text-ink-muted">
        Just landed
      </p>
      <p className="mt-1 text-title font-bold text-ink-primary">{name}</p>
      <p className="mt-1 text-caption text-ink-secondary">{meta}</p>

      <p className="mt-3 rounded-[14px] border border-hairline bg-surface-overlay px-3.5 py-3 text-caption text-ink-secondary">
        {asked && (
          <>
            <strong className="font-bold text-ink-primary">Asked:</strong>{" "}
            {asked}.{" "}
          </>
        )}
        <strong className="font-bold text-ink-primary">Delivered:</strong>{" "}
        {delivered}
      </p>

      {stats.length > 0 && (
        <div className="mt-3 grid grid-cols-2 gap-2 lg:grid-cols-3">
          {stats.map((s) => (
            <div
              key={s.label}
              className="rounded-[14px] border border-hairline bg-surface-overlay px-3 py-2.5"
            >
              <p className="font-numeric text-body font-bold leading-none text-ink-primary">
                {s.value}
                {s.unit && (
                  <span className="ml-0.5 text-label font-normal text-ink-muted">
                    {s.unit}
                  </span>
                )}
              </p>
              <p className="mt-1.5 text-label font-bold uppercase tracking-[0.14em] text-ink-muted">
                {s.label}
              </p>
            </div>
          ))}
        </div>
      )}

      {debrief && (
        <div className="mt-3 border-t border-hairline pt-3">
          <div className="flex items-baseline justify-between gap-3">
            <h3 className="text-label font-bold uppercase tracking-[0.14em] text-ink-muted">
              Debrief
            </h3>
            {debrief.answer && (
              <span className="text-label font-bold text-chart-2">
                {debrief.answer}
              </span>
            )}
          </div>
          {debrief.notes && (
            <p className="mt-2 text-caption italic leading-snug text-ink-secondary">
              &ldquo;{debrief.notes}&rdquo;
            </p>
          )}
          {debrief.review && (
            <p className="mt-2 whitespace-pre-wrap text-caption leading-[1.55] text-ink-secondary">
              <strong className="font-bold text-coach-ink">Coach: </strong>
              <InlineMarkdown text={debrief.review} />
            </p>
          )}
        </div>
      )}

      {streams.length > 0 && (
        <div
          data-streams
          className="mt-3 grid grid-cols-2 gap-1.5 lg:grid-cols-4"
        >
          {streams.map((s) => (
            <div
              key={s.label}
              className="rounded-[10px] border border-hairline bg-surface-overlay px-2 py-1.5"
            >
              <p className="text-label font-bold text-ink-muted">{s.label}</p>
              <svg
                aria-hidden
                viewBox="0 0 100 20"
                preserveAspectRatio="none"
                className="mt-1 block h-5 w-full"
              >
                <path
                  d={s.path}
                  fill="none"
                  className={s.className}
                  strokeWidth={1.5}
                  vectorEffect="non-scaling-stroke"
                />
              </svg>
            </div>
          ))}
        </div>
      )}

      <div className="mt-3 flex items-center justify-between gap-3 border-t border-hairline pt-3">
        {lapCount != null && lapCount > 0 ? (
          <span className="rounded-full border border-hairline px-3 py-1 text-label font-bold text-ink-secondary">
            {lapCount} laps recorded
          </span>
        ) : (
          <span />
        )}
        <Link
          href={`/activity/${activityId}`}
          className="text-caption font-bold text-accent"
        >
          View full activity, laps &amp; streams →
        </Link>
      </div>
    </section>
  );
}
