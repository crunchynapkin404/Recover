import type { PlanStyle } from "@/lib/plan-style/types";

const LABEL: Record<PlanStyle, string> = {
  balanced: "Balanced",
  block_lite: "Block-lite",
};

/**
 * Same segmented-control shape and chip-trap reasoning as SeasonModeSwitch
 * (its neighbour in the "plan-setup" sheet, slice 2 task 2) — see that
 * file's header comment.
 */
export function PlanStyleSwitch({
  effectiveStyle,
  action,
}: {
  effectiveStyle: PlanStyle;
  action: (formData: FormData) => void | Promise<void>;
}) {
  return (
    <div className="flex items-center gap-1 rounded-full border border-hairline bg-surface-selected p-1">
      <span className="px-2 text-label font-semibold text-ink-secondary">
        Style
      </span>
      {(["balanced", "block_lite"] as const).map((style) => {
        const active = style === effectiveStyle;
        return (
          <form key={style} action={action}>
            <input type="hidden" name="style" value={style} />
            <button
              type="submit"
              aria-pressed={active}
              disabled={active}
              className={`rounded-full px-2.5 py-1 text-label font-bold transition-colors ${
                active
                  ? "bg-surface-overlay text-ink-primary"
                  : "text-ink-muted hover:text-ink-secondary"
              }`}
            >
              {LABEL[style]}
            </button>
          </form>
        );
      })}
    </div>
  );
}
