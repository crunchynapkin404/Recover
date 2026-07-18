interface Props {
  deepSecs: number;
  remSecs: number;
  lightSecs: number;
  awakeSecs: number;
  fractions: { deep: number; rem: number; light: number; awake: number };
  /** Local "HH:MM" bed window when the provider sent it. */
  bedWindow: { start: string; end: string } | null;
}

const STAGES = [
  { key: "deep", label: "Deep", color: "#4338ca" },
  { key: "rem", label: "REM", color: "#7c3aed" },
  { key: "light", label: "Light", color: "#3b82f6" },
  { key: "awake", label: "Awake", color: "rgba(255,255,255,0.25)" },
] as const;

function fmt(secs: number): string {
  const h = Math.floor(secs / 3600);
  const m = Math.round((secs % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

/**
 * Sleep-stage breakdown (v0.12) — a stacked hypnogram-lite bar plus
 * per-stage minutes. Only mounted by the dashboard when the provider
 * actually sent stage data; there is no estimated fallback.
 */
export function SleepStagesCard({
  deepSecs,
  remSecs,
  lightSecs,
  awakeSecs,
  fractions,
  bedWindow,
}: Props) {
  const secs = {
    deep: deepSecs,
    rem: remSecs,
    light: lightSecs,
    awake: awakeSecs,
  };
  return (
    <div className="glass rounded-[2rem] p-7">
      <div className="mb-5 flex items-center justify-between">
        <span className="label-micro">Sleep Stages</span>
        {bedWindow && (
          <span className="text-xs font-bold text-white/80">
            {bedWindow.start} – {bedWindow.end}
          </span>
        )}
      </div>

      <div className="mb-5 flex h-4 w-full overflow-hidden rounded-full bg-white/5">
        {STAGES.map((s) => (
          <div
            key={s.key}
            style={{
              width: `${fractions[s.key] * 100}%`,
              background: s.color,
            }}
            aria-label={`${s.label} ${Math.round(fractions[s.key] * 100)}%`}
          />
        ))}
      </div>

      <div className="grid grid-cols-4 gap-2">
        {STAGES.map((s) => (
          <div key={s.key} className="flex flex-col">
            <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-white/50">
              <span
                aria-hidden
                className="h-2 w-2 rounded-full"
                style={{ background: s.color }}
              />
              {s.label}
            </span>
            <span className="mt-1 text-sm font-bold tabular-nums text-white">
              {fmt(secs[s.key])}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
