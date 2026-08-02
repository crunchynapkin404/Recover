import Link from "next/link";

export interface StripNight {
  date: string;
  sleepSecs: number | null;
  sleepDeepSecs: number | null;
  sleepRemSecs: number | null;
  sleepLightSecs: number | null;
}

interface Props {
  nights: StripNight[];
  selectedDate: string | null;
  href: (night: string) => string;
}

/** "31" from "2026-07-31" — the strip is dense, so day-of-month only. */
function dayLabel(date: string): string {
  return date.slice(8, 10);
}

/** Weekday initial, for orientation without spending width on a full name. */
function weekdayLabel(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  // Constructed as UTC and read back as UTC: a local-time Date here would
  // shift the weekday for anyone east or west of the server.
  return ["S", "M", "T", "W", "T", "F", "S"][
    new Date(Date.UTC(y, m - 1, d)).getUTCDay()
  ];
}

const SEGMENTS = [
  { key: "sleepDeepSecs", color: "#3b82f6" },
  { key: "sleepRemSecs", color: "#8b5cf6" },
  { key: "sleepLightSecs", color: "rgba(59,130,246,0.35)" },
] as const;

/**
 * v0.35 — the last N recorded nights, each as a mini stage bar.
 *
 * A night with a duration but no stages gets a single dimmed bar rather than
 * being hidden. That state is the reason this strip exists: the Companion
 * writes a night's duration before its stages, so the newest night is
 * routinely stage-less while the ones behind it are complete, and the old
 * single-night view made that look like the provider sent no stages at all.
 */
export function SleepHistoryStrip({ nights, selectedDate, href }: Props) {
  if (nights.length === 0) return null;

  // Newest first. `nights` arrives oldest → newest because the arrows step
  // through it by index, but 14 cells are wider than a phone viewport, so
  // rendering in that order pushes the newest night — the selected one, and
  // the one anybody opens this tab for — off-screen to the right. Caught in a
  // real browser: the cell measured x=528 on a 420px viewport and
  // elementFromPoint returned nothing. Reversing here is a presentation
  // concern only; the selection contract is unchanged, and this needs no
  // client-side scrolling.
  const display = [...nights].reverse();

  return (
    <nav
      aria-label="Sleep history"
      className="mb-3 -mx-1 overflow-x-auto px-1 pb-1"
    >
      <ul className="flex gap-1.5">
        {display.map((n) => {
          const total =
            (n.sleepDeepSecs ?? 0) +
            (n.sleepRemSecs ?? 0) +
            (n.sleepLightSecs ?? 0);
          const hasStages = total > 0;
          const isSelected = n.date === selectedDate;

          return (
            <li key={n.date} className="shrink-0">
              <Link
                href={href(n.date)}
                aria-current={isSelected ? "date" : undefined}
                aria-label={`${n.date}${hasStages ? "" : ", no stage data"}`}
                className={`flex w-9 flex-col items-center gap-1 rounded-[9px] border px-1 py-1.5 transition-colors ${
                  isSelected
                    ? "border-white/25 bg-white/[0.07]"
                    : "border-transparent hover:bg-white/[0.04]"
                }`}
              >
                <span className="text-[8px] font-bold uppercase tracking-wider text-white/35">
                  {weekdayLabel(n.date)}
                </span>
                <span
                  className={`text-[11px] font-bold ${
                    isSelected ? "text-white/90" : "text-white/55"
                  }`}
                >
                  {dayLabel(n.date)}
                </span>
                <span
                  aria-hidden
                  className="flex h-6 w-1.5 flex-col-reverse overflow-hidden rounded-full"
                >
                  {hasStages ? (
                    SEGMENTS.map((s) => {
                      const secs = n[s.key] ?? 0;
                      if (secs <= 0) return null;
                      return (
                        <span
                          key={s.key}
                          style={{
                            height: `${(secs / total) * 100}%`,
                            background: s.color,
                          }}
                        />
                      );
                    })
                  ) : (
                    <span className="h-full bg-white/[0.12]" />
                  )}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
