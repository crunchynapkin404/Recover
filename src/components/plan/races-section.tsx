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
  /** Days the event runs over. 1 = a normal single-day race. */
  eventDays: number;
  /** TOTAL distance across all days, km. null = demand not computable. */
  distanceKm: number | null;
  /** TOTAL elevation gain across all days, m. */
  elevationM: number | null;
  /** Whether per-day stage detail is on file for this race — distinct from
   * `eventDays > 1`, since a multi-day event can still have only the totals
   * filled in. */
  hasStages: boolean;
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

/**
 * What's actually driving this race's training-volume demand — the whole
 * point of Finding I6: an athlete must be able to confirm what was stored,
 * not just that the add form once accepted it. A mistyped 20,000m instead
 * of 2,000m is invisible unless this line prints it back.
 */
function demandSummary(race: RaceListItem): string {
  const parts: string[] = [];
  if (race.eventDays > 1) parts.push(`${race.eventDays} days`);
  if (race.distanceKm != null) {
    parts.push(`${Math.round(race.distanceKm * 10) / 10}km`);
  }
  if (race.elevationM != null) parts.push(`${Math.round(race.elevationM)}m`);
  if (race.hasStages) parts.push("per-day detail");
  return parts.length > 0 ? parts.join(" · ") : "No distance/elevation set";
}

export function RacesSection({ races, hideHeading = false }: Props) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const detailsRef = useRef<HTMLDetailsElement>(null);

  const [eventDays, setEventDays] = useState(1);
  const [distanceKm, setDistanceKm] = useState<number | null>(null);
  const [elevationM, setElevationM] = useState<number | null>(null);
  const [stages, setStages] = useState<
    { distanceKm: number | null; elevationM: number | null }[]
  >([]);

  function setStageField(
    index: number,
    field: "distanceKm" | "elevationM",
    raw: string
  ) {
    const value = raw === "" ? null : Number(raw);
    setStages((prev) => {
      const next = [...prev];
      while (next.length <= index) {
        next.push({ distanceKm: null, elevationM: null });
      }
      next[index] = { ...next[index], [field]: value };
      return next;
    });
  }

  /**
   * Per-day rows as the server wants them. A one-day event has no stages by
   * definition, and a multi-day event nobody filled in sends none rather than a
   * row of nulls per day — `eventDemand` reads an empty list as "no per-day
   * detail" and falls back to the average day, which is exactly right.
   */
  function stagesForSubmit() {
    if (eventDays <= 1) return [];
    const rows = Array.from({ length: eventDays }, (_, i) => ({
      dayNumber: i + 1,
      distanceKm: stages[i]?.distanceKm ?? null,
      elevationM: stages[i]?.elevationM ?? null,
    }));
    return rows.some((r) => r.distanceKm != null || r.elevationM != null)
      ? rows
      : [];
  }

  function resetDemandFields() {
    setEventDays(1);
    setDistanceKm(null);
    setElevationM(null);
    setStages([]);
  }

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
      try {
        const result = await addRace({
          name,
          raceType,
          date,
          priority,
          goalNote: goalNote.length > 0 ? goalNote : undefined,
          eventDays,
          distanceKm,
          elevationM,
          stages: stagesForSubmit(),
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
        resetDemandFields();
        if (detailsRef.current) detailsRef.current.open = false;
      } catch {
        // addRace is a directly reachable server action — an unexpected
        // throw (e.g. a DB error) must not become an unhandled rejection
        // with nothing shown to the athlete.
        setError("Couldn't save that race — please try again.");
      }
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
                  <p className="mt-0.5 truncate text-[10.5px] text-white/35">
                    {demandSummary(race)}
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
            id="race-name"
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
            id="race-date"
            name="date"
            type="date"
            required
            className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white focus:border-white/30 focus:outline-none"
          />

          <label className="label-micro" htmlFor="event-days">
            Days
          </label>
          <input
            id="event-days"
            type="number"
            min={1}
            value={eventDays}
            onChange={(e) =>
              setEventDays(Math.max(1, Number(e.target.value) || 1))
            }
            className="w-full rounded-xl bg-white/[0.06] px-3 py-2 text-sm"
          />

          <label className="label-micro" htmlFor="event-distance">
            Total distance (km)
          </label>
          <input
            id="event-distance"
            type="number"
            min={0}
            value={distanceKm ?? ""}
            onChange={(e) =>
              setDistanceKm(
                e.target.value === "" ? null : Number(e.target.value)
              )
            }
            className="w-full rounded-xl bg-white/[0.06] px-3 py-2 text-sm"
          />

          <label className="label-micro" htmlFor="event-elevation">
            Total elevation (m)
          </label>
          <input
            id="event-elevation"
            type="number"
            min={0}
            value={elevationM ?? ""}
            onChange={(e) =>
              setElevationM(
                e.target.value === "" ? null : Number(e.target.value)
              )
            }
            className="w-full rounded-xl bg-white/[0.06] px-3 py-2 text-sm"
          />

          {eventDays > 1 && (
            <details className="mt-3">
              <summary className="label-micro cursor-pointer">
                Per-day detail (optional)
              </summary>
              <p className="mt-1 text-[11px] text-white/50">
                Enter each day and we can tell you what your longest training
                ride needs to be. Without it we assume every day is the average.
              </p>
              {Array.from({ length: eventDays }, (_, i) => (
                <div key={i} className="mt-2 flex items-center gap-2">
                  <span className="w-12 text-[11px] text-white/50">{`Day ${i + 1}`}</span>
                  <input
                    aria-label={`Day ${i + 1} distance in km`}
                    type="number"
                    min={0}
                    value={stages[i]?.distanceKm ?? ""}
                    onChange={(e) =>
                      setStageField(i, "distanceKm", e.target.value)
                    }
                    className="w-24 rounded-lg bg-white/[0.06] px-2 py-1 text-[12px]"
                  />
                  <input
                    aria-label={`Day ${i + 1} elevation in m`}
                    type="number"
                    min={0}
                    value={stages[i]?.elevationM ?? ""}
                    onChange={(e) =>
                      setStageField(i, "elevationM", e.target.value)
                    }
                    className="w-24 rounded-lg bg-white/[0.06] px-2 py-1 text-[12px]"
                  />
                </div>
              ))}
            </details>
          )}

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
