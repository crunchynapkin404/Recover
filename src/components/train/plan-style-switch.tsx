import type { PlanStyle } from "@/lib/plan-style/types";

const LABEL: Record<PlanStyle, string> = {
  balanced: "Balanced",
  block_lite: "Block-lite",
};

export function PlanStyleSwitch({
  effectiveStyle,
  action,
}: {
  effectiveStyle: PlanStyle;
  action: (formData: FormData) => void | Promise<void>;
}) {
  return (
    <div className="flex items-center gap-1 rounded-full border border-white/10 bg-white/[0.04] p-1">
      <span className="px-2 text-[10px] font-semibold text-white/60">
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
              className={`rounded-full px-2.5 py-1 text-[10px] font-bold transition-colors ${
                active
                  ? "bg-white/[0.16] text-white"
                  : "text-white/70 hover:bg-white/[0.08] hover:text-white"
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
