"use client";

import { useState, useTransition } from "react";
import { saveBloodPressure, setBirthYear } from "@/app/health/actions";
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsiblePanel,
} from "@/components/ui/collapsible";

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
    <Collapsible>
      <CollapsibleTrigger>
        <span className="label-micro">Your details &amp; blood pressure</span>
      </CollapsibleTrigger>
      <CollapsiblePanel>
        <div className="space-y-5 p-5 pt-4">
          <div>
            <h3 className="text-caption font-bold text-ink-primary">
              Your details
            </h3>
            <div className="mt-3 flex items-end gap-3">
              <label className="flex flex-col text-label text-ink-muted">
                Birth year
                <input
                  type="number"
                  value={year}
                  onChange={(e) => setYear(e.target.value)}
                  placeholder="1990"
                  className="mt-1 w-28 rounded-xl border border-hairline bg-surface-overlay px-3 py-2 text-caption text-ink-primary"
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
                className="rounded-full border border-hairline bg-surface-overlay px-4 py-2 text-label font-bold uppercase tracking-wider disabled:opacity-50"
              >
                Save
              </button>
            </div>
          </div>

          <div className="border-t border-hairline pt-4">
            <h3 className="text-caption font-bold text-ink-primary">
              Log blood pressure
            </h3>
            <div className="mt-3 flex flex-wrap items-end gap-3">
              <label className="flex flex-col text-label text-ink-muted">
                Date
                <input
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className="mt-1 rounded-xl border border-hairline bg-surface-overlay px-3 py-2 text-caption text-ink-primary"
                />
              </label>
              <label className="flex flex-col text-label text-ink-muted">
                Systolic
                <input
                  type="number"
                  value={sys}
                  onChange={(e) => setSys(e.target.value)}
                  placeholder="118"
                  className="mt-1 w-20 rounded-xl border border-hairline bg-surface-overlay px-3 py-2 text-caption text-ink-primary"
                />
              </label>
              <label className="flex flex-col text-label text-ink-muted">
                Diastolic
                <input
                  type="number"
                  value={dia}
                  onChange={(e) => setDia(e.target.value)}
                  placeholder="76"
                  className="mt-1 w-20 rounded-xl border border-hairline bg-surface-overlay px-3 py-2 text-caption text-ink-primary"
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
                className="rounded-full bg-accent px-4 py-2 text-label font-bold uppercase tracking-wider text-primary-foreground disabled:opacity-50"
              >
                Save
              </button>
            </div>
          </div>

          {msg && <p className="text-label text-ink-secondary">{msg}</p>}
        </div>
      </CollapsiblePanel>
    </Collapsible>
  );
}
