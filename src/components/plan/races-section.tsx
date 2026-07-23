"use client";

import { useRef, useState, useTransition } from "react";
import { Trash2 } from "lucide-react";
import { addRace, removeRace, setRaceStatus } from "@/app/plan/actions";
import type { RacePriority, RaceStatus } from "@/lib/race/service";

export interface RaceListItem {
  id: string;
  name: string;
  raceType: string;
  date: string;
  priority: RacePriority;
  status: RaceStatus;
  goalNote: string | null;
}

interface Props {
  races: RaceListItem[];
  /**
   * Drops the section's own "Races" label. Train's Week segment nests this
   * under a disclosure whose trigger already says it.
   */
  hideHeading?: boolean;
}

// Repo avoids blue/indigo for accents — A races get the same fuchsia the
// week strip and STATUS_CHIP use for race days.
const PRIORITY_CHIP: Record<RacePriority, string> = {
  A: "border-fuchsia-400/30 text-fuchsia-300",
  B: "border-amber-400/30 text-amber-400",
  C: "border-white/15 text-white/60",
};

const STATUS_LABEL: Record<RaceStatus, string> = {
  upcoming: "Upcoming",
  completed: "Completed",
  skipped: "Skipped",
};

export function RacesSection({ races, hideHeading = false }: Props) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const detailsRef = useRef<HTMLDetailsElement>(null);

  function handleAdd(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const data = new FormData(form);
    const name = String(data.get("name") ?? "").trim();
    const raceType = String(data.get("raceType") ?? "").trim();
    const date = String(data.get("date") ?? "");
    const priority = String(data.get("priority") ?? "B") as RacePriority;
    const goalNote = String(data.get("goalNote") ?? "").trim();

    setError(null);
    startTransition(async () => {
      const result = await addRace({
        name,
        raceType,
        date,
        priority,
        goalNote: goalNote.length > 0 ? goalNote : undefined,
      });
      if (!result.ok) {
        setError(
          result.error === "past_date"
            ? "Race date must be today or later."
            : result.error
        );
        return;
      }
      form.reset();
      if (detailsRef.current) detailsRef.current.open = false;
    });
  }

  return (
    <section className="mb-10">
      {!hideHeading && <p className="label-micro mb-3">Races</p>}

      {races.length === 0 ? (
        <div className="glass mb-4 rounded-2xl p-5">
          <p className="text-sm text-white/50">
            No races yet — add one so the plan can taper toward it.
          </p>
        </div>
      ) : (
        <div className="glass mb-4 overflow-hidden rounded-2xl">
          <ul className="divide-y divide-white/5">
            {races.map((race) => (
              <li
                key={race.id}
                className="flex items-center justify-between gap-3 px-5 py-4"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span
                      className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${PRIORITY_CHIP[race.priority]}`}
                    >
                      {race.priority}
                    </span>
                    <p className="truncate text-sm font-bold text-white">
                      {race.name}
                    </p>
                  </div>
                  <p className="mt-1 truncate text-[11px] text-white/50">
                    {`${race.raceType} · ${race.date}`}
                    {race.goalNote && ` · ${race.goalNote}`}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <select
                    defaultValue={race.status}
                    aria-label={`Status for ${race.name}`}
                    disabled={pending}
                    onChange={(e) => {
                      const status = e.target.value as RaceStatus;
                      startTransition(async () => {
                        await setRaceStatus(race.id, status);
                      });
                    }}
                    className="rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-[11px] text-white/70 focus:border-white/30 focus:outline-none disabled:opacity-50"
                  >
                    {(Object.keys(STATUS_LABEL) as RaceStatus[]).map((s) => (
                      <option key={s} value={s}>
                        {STATUS_LABEL[s]}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    aria-label={`Delete ${race.name}`}
                    disabled={pending}
                    onClick={() => {
                      if (
                        confirm(`Delete ${race.name}? This can't be undone.`)
                      ) {
                        startTransition(async () => {
                          await removeRace(race.id);
                        });
                      }
                    }}
                    className="rounded-full p-2 text-white/60 transition-colors hover:bg-red-500/10 hover:text-red-400 disabled:opacity-50"
                  >
                    <Trash2 aria-hidden className="size-4" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      <details ref={detailsRef} className="glass rounded-2xl">
        <summary className="cursor-pointer list-none px-5 py-3 text-[11px] font-bold uppercase tracking-wider text-emerald-400">
          + Add race
        </summary>
        <form onSubmit={handleAdd} className="space-y-3 px-5 pb-5">
          <input
            name="name"
            required
            placeholder="Race name"
            className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/30 focus:border-white/30 focus:outline-none"
          />
          <div className="grid grid-cols-2 gap-3">
            <input
              name="raceType"
              required
              placeholder="Type (e.g. marathon)"
              className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/30 focus:border-white/30 focus:outline-none"
            />
            <select
              name="priority"
              defaultValue="B"
              aria-label="Priority"
              className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white focus:border-white/30 focus:outline-none"
            >
              <option value="A">A — season goal</option>
              <option value="B">B — tune-up</option>
              <option value="C">C — training race</option>
            </select>
          </div>
          <input
            name="date"
            type="date"
            required
            className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white focus:border-white/30 focus:outline-none"
          />
          <input
            name="goalNote"
            placeholder="Goal note (optional)"
            className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/30 focus:border-white/30 focus:outline-none"
          />
          <button
            type="submit"
            disabled={pending}
            className="w-full rounded-2xl bg-emerald-500/90 py-2.5 text-sm font-bold text-neutral-950 transition-opacity disabled:opacity-50"
          >
            {pending ? "Adding…" : "Add race"}
          </button>
          {error && (
            <p role="status" className="text-center text-[12px] text-red-400">
              {error}
            </p>
          )}
        </form>
      </details>
    </section>
  );
}
