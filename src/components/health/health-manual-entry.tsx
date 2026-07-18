"use client";

import { useState, useTransition } from "react";
import { saveBloodPressure, setBirthYear } from "@/app/health/actions";

function todayYmd(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

interface Props {
  birthYear: number | null;
}

/** Birth year (unlocks bio-age) + manual blood-pressure entry. */
export function HealthManualEntry({ birthYear }: Props) {
  const [year, setYear] = useState(birthYear?.toString() ?? "");
  const [date, setDate] = useState(todayYmd());
  const [sys, setSys] = useState("");
  const [dia, setDia] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <div className="glass rounded-[2rem] p-6 space-y-5">
      <div>
        <h2 className="text-sm font-bold">Your details</h2>
        <div className="mt-3 flex items-end gap-3">
          <label className="flex flex-col text-[11px] text-white/50">
            Birth year
            <input
              type="number"
              value={year}
              onChange={(e) => setYear(e.target.value)}
              placeholder="1990"
              className="mt-1 w-28 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white"
            />
          </label>
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const res = await setBirthYear(
                  year.trim() ? Number(year) : null
                );
                setMsg(res.message);
              })
            }
            className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-[10px] font-bold uppercase tracking-wider disabled:opacity-50"
          >
            Save
          </button>
        </div>
      </div>

      <div className="border-t border-white/5 pt-4">
        <h2 className="text-sm font-bold">Log blood pressure</h2>
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <label className="flex flex-col text-[11px] text-white/50">
            Date
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="mt-1 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white"
            />
          </label>
          <label className="flex flex-col text-[11px] text-white/50">
            Systolic
            <input
              type="number"
              value={sys}
              onChange={(e) => setSys(e.target.value)}
              placeholder="118"
              className="mt-1 w-20 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white"
            />
          </label>
          <label className="flex flex-col text-[11px] text-white/50">
            Diastolic
            <input
              type="number"
              value={dia}
              onChange={(e) => setDia(e.target.value)}
              placeholder="76"
              className="mt-1 w-20 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white"
            />
          </label>
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const res = await saveBloodPressure(
                  date,
                  Number(sys),
                  Number(dia)
                );
                setMsg(res.message);
                if (res.ok) {
                  setSys("");
                  setDia("");
                }
              })
            }
            className="rounded-full bg-emerald-500 px-4 py-2 text-[10px] font-bold uppercase tracking-wider text-black disabled:opacity-50"
          >
            Save
          </button>
        </div>
      </div>

      {msg && <p className="text-xs text-white/60">{msg}</p>}
    </div>
  );
}
