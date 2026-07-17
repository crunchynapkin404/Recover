"use client";

import { useActionState, useState } from "react";

export interface IntakeState {
  message: string;
}

interface Props {
  /** Suggested availableMins per day, Monday first (7 entries). */
  suggested: number[];
  action: (prev: IntakeState, formData: FormData) => Promise<IntakeState>;
}

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function IntakeForm({ suggested, action }: Props) {
  const [state, formAction, pending] = useActionState(action, { message: "" });
  const [mins, setMins] = useState(() =>
    Array.from({ length: 7 }, (_, i) => String(suggested[i] ?? 0))
  );

  return (
    <form action={formAction} className="glass rounded-[2rem] p-7">
      <p className="label-micro mb-1">This week&apos;s availability</p>
      <p className="mb-5 text-[12px] text-white/50">
        Minutes you can train per day — the week plans itself around this.
      </p>
      <div className="mb-6 grid grid-cols-7 gap-2">
        {mins.map((v, i) => (
          <label
            key={DAY_LABELS[i]}
            className="flex flex-col items-center gap-2"
          >
            <span className="text-[10px] font-bold uppercase tracking-wider text-white/40">
              {DAY_LABELS[i]}
            </span>
            <input
              type="number"
              name={`mins-${i}`}
              min={0}
              max={720}
              step={5}
              inputMode="numeric"
              value={v}
              onChange={(e) =>
                setMins((prev) =>
                  prev.map((m, j) => (j === i ? e.target.value : m))
                )
              }
              className="w-full rounded-xl border border-white/10 bg-white/5 px-1 py-2 text-center text-sm font-bold text-white focus:border-white/30 focus:outline-none"
            />
          </label>
        ))}
      </div>
      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-2xl bg-emerald-500/90 py-3 text-sm font-bold text-neutral-950 transition-opacity disabled:opacity-50"
      >
        Confirm week
      </button>
      {state.message !== "" && (
        <p className="mt-3 text-center text-[12px] text-white/60">
          {state.message}
        </p>
      )}
    </form>
  );
}
