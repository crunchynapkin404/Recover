import type { Band } from "@/lib/readiness";
import { BAND_GLOW, BAND_STROKE, BAND_TEXT } from "@/lib/band-color";

const BAND_VERDICT: Record<Band, string> = {
  green: "✓ Strong · ready for intensity",
  amber: "⚡ Moderate · easy work",
  red: "⚠ Low · prioritize rest",
  calibrating: "Calibrating · learning baseline",
};

/**
 * The verdict in one word, without the advice clause.
 *
 * Used when the reading is not today's: "ready for intensity" is a
 * recommendation about a body measured days ago, and a date alone is a weak
 * contradiction of it. The band still describes what was measured, so the
 * word stays and the advice goes.
 */
const BAND_WORD: Record<Band, string> = {
  green: "Strong",
  amber: "Moderate",
  red: "Low",
  calibrating: "Calibrating",
};

export interface TodayHeroWhy {
  hrv: number | null;
  hrvBaseline: number | null;
  rhr: number | null;
  sleepHours: number | null;
  tsb: number | null;
}

interface Props {
  /** null → calibrating (track-only ring, "—" score). */
  readiness: number | null;
  band: Band;
  recoveryScore: number | null;
  sleepScore: number | null;
  why: TodayHeroWhy;
  /**
   * When the reading is from, when it is NOT today's — "yesterday",
   * "Monday", "12 days ago". null for today's reading, which is the normal
   * case and renders the card with nothing added.
   *
   * From describeReadingAge() (src/lib/today/reading-age.ts). This replaced
   * a `staleLabel` driven by TIME OF DAY, which marked a reading taken that
   * same morning as stale at 18:00 and left a three-week-old one unmarked at
   * 07:00. The card no longer varies by hour at all.
   */
  readingAge?: string | null;
}

// One geometry, scaled by CSS at lg+ (3a wants a 150px ring) so the ring's
// own draw-in animation and stroke maths stay in one place.
const SIZE = 104;
const STROKE = 8;
const R = (SIZE - STROKE) / 2; // 48
const CIRC = 2 * Math.PI * R;

function fmtClock(hours: number): string {
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  return `${h}:${String(m).padStart(2, "0")}`;
}

/** TSB to one decimal with a real minus sign: -1.94 → "−1.9". */
export function fmtTsb(tsb: number): string {
  const v = Math.abs(tsb).toFixed(1);
  return tsb < 0 ? `−${v}` : v;
}

// One line of numbers, never prose — built from the same inputs buildNarrative
// used. Any missing signal is simply dropped (honest, never invented).
function buildWhy(why: TodayHeroWhy): string {
  const parts: string[] = [];
  if (why.hrv != null)
    parts.push(
      why.hrvBaseline != null
        ? `HRV ${Math.round(why.hrv)} vs ${Math.round(why.hrvBaseline)} baseline`
        : `HRV ${Math.round(why.hrv)}`
    );
  if (why.rhr != null) parts.push(`RHR ${Math.round(why.rhr)}`);
  if (why.sleepHours != null) parts.push(`slept ${fmtClock(why.sleepHours)}`);
  if (why.tsb != null) parts.push(`TSB ${fmtTsb(why.tsb)}`);
  return parts.join(" · ");
}

/**
 * Today's hero. One readiness ring keyed to the band, a verdict, a one-line
 * numeric "why", and a Recovery/Sleep legend. The ring draws in via the
 * shared `.ring-fill` CSS animation; calibrating shows only the empty track.
 *
 * v0.99 slice 1: on the token type/ink scale, and gains the compact recap
 * the post-session and evening states carry below their own lead block.
 */
export function TodayHero({
  readiness,
  band,
  recoveryScore,
  sleepScore,
  why,
  readingAge = null,
}: Props) {
  const calibrating = band === "calibrating" || readiness == null;
  const filled = calibrating ? 0 : Math.max(0, Math.min(100, readiness ?? 0));
  const targetOffset = CIRC - (CIRC * filled) / 100;
  const whyLine = buildWhy(why);
  const shown = calibrating ? "—" : String(Math.round(readiness ?? 0));
  const srScore = calibrating
    ? "Readiness calibrating"
    : `Readiness ${Math.round(readiness ?? 0)}`;

  const legend = [
    { label: "Recovery", tone: "bg-chart-2", value: recoveryScore },
    { label: "Sleep", tone: "bg-chart-1", value: sleepScore },
  ];

  return (
    <section
      className="flex items-center gap-4 rounded-[22px] glass glass-no-hover p-4 lg:gap-6 lg:p-6"
      style={{ boxShadow: `0 0 60px -20px ${BAND_GLOW[band]}` }}
    >
      <div className="relative aspect-square w-[104px] shrink-0 lg:w-[150px]">
        <svg
          aria-hidden
          viewBox={`0 0 ${SIZE} ${SIZE}`}
          className="h-full w-full -rotate-90"
        >
          <circle
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={R}
            fill="none"
            className="stroke-hairline opacity-35"
            strokeWidth={STROKE}
          />
          {!calibrating && (
            <circle
              cx={SIZE / 2}
              cy={SIZE / 2}
              r={R}
              fill="none"
              className={`ring-fill ${BAND_STROKE[band]}`}
              strokeWidth={STROKE}
              strokeLinecap="round"
              strokeDasharray={CIRC}
              strokeDashoffset={targetOffset}
              style={
                {
                  "--ring-circ": CIRC,
                  "--ring-offset": targetOffset,
                } as React.CSSProperties
              }
            />
          )}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span
            aria-hidden
            className={`font-numeric text-figure font-bold leading-none tracking-tighter lg:text-hero ${BAND_TEXT[band]}`}
          >
            {shown}
          </span>
          <span className="mt-1 text-label font-bold uppercase tracking-[0.14em] text-ink-muted">
            Readiness
          </span>
          <span className="sr-only">{srScore}</span>
        </div>
      </div>

      <div className="min-w-0 flex-1">
        {/* BAND_TEXT already maps calibrating to --ink-muted, so the old
            theme-blind rgba(255,255,255,0.6) ternary is simply gone. */}
        <p className={`text-body font-bold ${BAND_TEXT[band]}`}>
          {readingAge ? (
            <>
              From <span className="font-bold">{readingAge}</span> ·{" "}
              {BAND_WORD[band]}
            </>
          ) : (
            BAND_VERDICT[band]
          )}
        </p>
        {whyLine && (
          <p className="mt-1.5 text-caption leading-snug text-ink-secondary">
            {whyLine}
          </p>
        )}
        <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1">
          {legend.map((m) => (
            <span
              key={m.label}
              className="flex items-center gap-1.5 text-caption text-ink-secondary"
            >
              <span aria-hidden className={`h-2 w-2 rounded-full ${m.tone}`} />
              {m.label} {m.value != null ? Math.round(m.value) : "—"}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}
