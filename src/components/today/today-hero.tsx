import type { Band } from "@/lib/readiness";
import { BAND_COLOR, BAND_GLOW } from "@/lib/band-color";

const BAND_VERDICT: Record<Band, string> = {
  green: "✓ Strong · ready for intensity",
  amber: "⚡ Moderate · easy work",
  red: "⚠ Low · prioritize rest",
  calibrating: "Calibrating · learning baseline",
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
}

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
 * Today's hero — the single glass mega-card (2a). One readiness ring keyed to
 * the band, a verdict, a one-line numeric "why", and a Recovery/Sleep legend.
 * The ring draws in via the shared `.ring-fill` CSS animation; calibrating
 * shows only the empty track.
 */
export function TodayHero({
  readiness,
  band,
  recoveryScore,
  sleepScore,
  why,
}: Props) {
  const color = BAND_COLOR[band];
  const calibrating = band === "calibrating" || readiness == null;
  const filled = calibrating ? 0 : Math.max(0, Math.min(100, readiness ?? 0));
  const targetOffset = CIRC - (CIRC * filled) / 100;
  const whyLine = buildWhy(why);

  const legend = [
    { label: "Recovery", color: "#10b981", value: recoveryScore },
    { label: "Sleep", color: "#3b82f6", value: sleepScore },
  ];

  return (
    <section
      className="mb-6 flex items-center gap-4 rounded-[22px] border border-white/10 bg-white/5 p-4"
      style={{ boxShadow: `0 0 60px -20px ${BAND_GLOW[band]}` }}
    >
      <div className="relative shrink-0" style={{ width: SIZE, height: SIZE }}>
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
            stroke="rgba(255,255,255,0.07)"
            strokeWidth={STROKE}
          />
          {!calibrating && (
            <circle
              cx={SIZE / 2}
              cy={SIZE / 2}
              r={R}
              fill="none"
              stroke={color}
              strokeWidth={STROKE}
              strokeLinecap="round"
              strokeDasharray={CIRC}
              strokeDashoffset={targetOffset}
              className="ring-fill"
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
            className="text-[30px] font-bold leading-none tracking-tighter"
            style={{ color }}
          >
            {calibrating ? "—" : Math.round(readiness ?? 0)}
          </span>
          <span className="mt-1 text-[7.5px] font-bold uppercase tracking-[0.2em] text-white/40">
            Readiness
          </span>
          <span className="sr-only">
            {calibrating
              ? "Readiness calibrating"
              : `Readiness ${Math.round(readiness ?? 0)}`}
          </span>
        </div>
      </div>

      <div className="min-w-0 flex-1">
        <p
          className="text-[12.5px] font-bold"
          style={{ color: calibrating ? "rgba(255,255,255,0.6)" : color }}
        >
          {BAND_VERDICT[band]}
        </p>
        {whyLine && (
          <p className="mt-1.5 text-[11px] leading-snug text-white/55">
            {whyLine}
          </p>
        )}
        <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1">
          {legend.map((m) => (
            <span
              key={m.label}
              className="flex items-center gap-1.5 text-[10.5px] text-white/60"
            >
              <span
                aria-hidden
                className="h-2 w-2 rounded-full"
                style={{ backgroundColor: m.color }}
              />
              {m.label} {m.value != null ? Math.round(m.value) : "—"}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}
