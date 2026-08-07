const ACTIONS = [
  { value: "reduce_load", label: "Ease week", hint: "-30%" },
  { value: "deload_week", label: "Deload week", hint: "-50%" },
  { value: "increase_load", label: "Boost week", hint: "+10%" },
  { value: "skip_week", label: "Skip week", hint: "set to 0" },
] as const;

export function WeekAdjustmentSwitch({
  weekNumber,
  action,
}: {
  weekNumber: number;
  action: (formData: FormData) => void | Promise<void>;
}) {
  return (
    <div className="rounded-full border border-white/10 bg-white/[0.04] p-1">
      <div className="flex items-center gap-1">
        <span className="px-2 text-[10px] font-semibold text-white/60">
          Week
        </span>
        {ACTIONS.map((item) => (
          <form key={item.value} action={action}>
            <input type="hidden" name="weekAction" value={item.value} />
            <input type="hidden" name="weekNumber" value={String(weekNumber)} />
            <button
              type="submit"
              title={`${item.label} (${item.hint})`}
              aria-label={`${item.label} (${item.hint})`}
              className="rounded-full px-2.5 py-1 text-[10px] font-bold text-white/70 transition-colors hover:bg-white/[0.08] hover:text-white"
            >
              {item.label}
            </button>
          </form>
        ))}
      </div>
      <p className="px-2 pt-1 text-[9px] font-medium text-white/45">
        Ease -30% · Deload -50% · Boost +10% · Skip 0
      </p>
    </div>
  );
}
