const ACTIONS = [
  { value: "reduce_load", label: "Ease week" },
  { value: "deload_week", label: "Deload week" },
  { value: "increase_load", label: "Boost week" },
  { value: "skip_week", label: "Skip week" },
] as const;

export function WeekAdjustmentSwitch({
  weekNumber,
  action,
}: {
  weekNumber: number;
  action: (formData: FormData) => void | Promise<void>;
}) {
  return (
    <div className="flex items-center gap-1 rounded-full border border-white/10 bg-white/[0.04] p-1">
      <span className="px-2 text-[10px] font-semibold text-white/60">Week</span>
      {ACTIONS.map((item) => (
        <form key={item.value} action={action}>
          <input type="hidden" name="weekAction" value={item.value} />
          <input type="hidden" name="weekNumber" value={String(weekNumber)} />
          <button
            type="submit"
            className="rounded-full px-2.5 py-1 text-[10px] font-bold text-white/70 transition-colors hover:bg-white/[0.08] hover:text-white"
          >
            {item.label}
          </button>
        </form>
      ))}
    </div>
  );
}
