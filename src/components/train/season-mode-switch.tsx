import type { ReentryStage, SeasonMode } from "@/lib/season-mode/types";

const MODE_LABEL: Record<SeasonMode, string> = {
  normal: "Normal",
  off_season: "Off-season",
};

export function SeasonModeSwitch({
  effectiveSeasonMode,
  reentryStage,
  action,
}: {
  effectiveSeasonMode: SeasonMode;
  reentryStage: ReentryStage;
  action: (formData: FormData) => void | Promise<void>;
}) {
  return (
    <div className="flex items-center gap-1 rounded-full border border-white/10 bg-white/[0.04] p-1">
      <span className="px-2 text-[10px] font-semibold text-white/60">
        Season
      </span>
      {(["normal", "off_season"] as const).map((seasonMode) => {
        const active = seasonMode === effectiveSeasonMode;
        return (
          <form key={seasonMode} action={action}>
            <input type="hidden" name="seasonAction" value={seasonMode} />
            <button
              type="submit"
              aria-pressed={active}
              disabled={active}
              className={`rounded-full px-2.5 py-1 text-[10px] font-bold transition-colors ${
                active
                  ? "bg-white/[0.16] text-white"
                  : "text-white/70 hover:bg-white/[0.08] hover:text-white"
              }`}
            >
              {MODE_LABEL[seasonMode]}
            </button>
          </form>
        );
      })}
      {effectiveSeasonMode === "off_season" && reentryStage === "none" && (
        <form action={action}>
          <input type="hidden" name="seasonAction" value="begin_reentry" />
          <button
            type="submit"
            aria-pressed={false}
            className="rounded-full px-2.5 py-1 text-[10px] font-bold text-white/70 transition-colors hover:bg-white/[0.08] hover:text-white"
          >
            Start re-entry
          </button>
        </form>
      )}
      {reentryStage !== "none" && (
        <span className="rounded-full bg-emerald-400/10 px-2.5 py-1 text-[10px] font-bold text-emerald-300">
          {reentryStage === "week_1" ? "Re-entry week 1" : "Re-entry week 2"}
        </span>
      )}
    </div>
  );
}
