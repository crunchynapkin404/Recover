"use client";

import { Fragment, useRef, useState, useTransition } from "react";
import { PendingButton } from "@/components/ui/pending-button";
import { Pencil, Trash2 } from "lucide-react";
import {
  addRace,
  removeRace,
  setRaceStatus,
  updateRaceDemand,
} from "@/app/plan/actions";
import type { RacePriority, RaceStatus } from "@/lib/race/service";
import {
  PLAN_SPORTS,
  SPORT_LABEL,
  inferPlanSport,
  type PlanSport,
} from "@/lib/plan-sport";

export interface RaceStageItem {
  dayNumber: number;
  distanceKm: number | null;
  elevationM: number | null;
}

export interface RaceListItem {
  id: string;
  name: string;
  raceType: string;
  date: string;
  priority: RacePriority;
  status: RaceStatus;
  goalNote: string | null;
  sport: PlanSport;
  /**
   * The athlete's own figure for how long the event takes them. Wins over
   * every model — the only way a first-time triathlete gets a figure at all.
   */
  expectedFinishHours: number | null;
  /** Days the event runs over. 1 = a normal single-day race. */
  eventDays: number;
  /** TOTAL distance across all days, km. null = demand not computable. */
  distanceKm: number | null;
  /** TOTAL elevation gain across all days, m. */
  elevationM: number | null;
  /** Per-day stage detail on file for this race, day-ascending. Distinct
   * from `eventDays > 1`, since a multi-day event can still have only the
   * totals filled in — an empty array here means no per-day detail, not
   * necessarily a one-day event. */
  stages: RaceStageItem[];
}

interface Props {
  races: RaceListItem[];
  /**
   * Drops the section's own "Races" label. Train's Week segment nests this
   * under a disclosure whose trigger already says it.
   */
  hideHeading?: boolean;
}

// Repo avoids blue/indigo for accents — A races get the same --ink-race
// token the week strip and STATUS_DOT use for race days.
const PRIORITY_CHIP: Record<RacePriority, string> = {
  A: "border-ink-race/30 text-ink-race",
  B: "border-hairline text-chart-3",
  C: "border-hairline text-ink-secondary",
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
  if (race.stages.length > 0) parts.push("per-day detail");
  return parts.length > 0 ? parts.join(" · ") : "No distance/elevation set";
}

/**
 * Sport select, shared by the add form and the per-race edit form so the
 * two can never drift on the set of choices or their labels. `required`
 * plus a controlled value means there is no empty/unselected state to
 * account for downstream.
 */
function SportSelect({
  id,
  ariaLabel,
  value,
  onChange,
}: {
  id: string;
  ariaLabel: string;
  value: PlanSport;
  onChange: (s: PlanSport) => void;
}) {
  return (
    <>
      <label className="label-micro" htmlFor={id}>
        Sport
      </label>
      <select
        id={id}
        aria-label={ariaLabel}
        required
        value={value}
        onChange={(e) => onChange(e.target.value as PlanSport)}
        className="w-full rounded-xl border border-hairline px-3 py-2 text-caption text-ink-primary focus:border-accent focus:outline-none"
      >
        {PLAN_SPORTS.map((s) => (
          <option key={s} value={s}>
            {SPORT_LABEL[s]}
          </option>
        ))}
      </select>
    </>
  );
}

/**
 * Per-day distance/elevation rows, controlled from the parent's state.
 * Shared by the add form and the per-race edit form (Finding I6 part 2) so
 * the two never drift on markup or field names — only the id/aria-label
 * prefix differs, so multiple instances (an open "Add race" panel plus an
 * open edit row) never collide.
 */
function DemandFields({
  idPrefix,
  ariaPrefix,
  eventDays,
  distanceKm,
  elevationM,
  stages,
  expectedFinishHours,
  onEventDaysChange,
  onDistanceChange,
  onElevationChange,
  onStageChange,
  onExpectedFinishChange,
}: {
  idPrefix: string;
  ariaPrefix: string;
  eventDays: number;
  distanceKm: number | null;
  elevationM: number | null;
  stages: { distanceKm: number | null; elevationM: number | null }[];
  expectedFinishHours: number | null;
  onEventDaysChange: (n: number) => void;
  onDistanceChange: (n: number | null) => void;
  onElevationChange: (n: number | null) => void;
  onStageChange: (
    index: number,
    field: "distanceKm" | "elevationM",
    raw: string
  ) => void;
  onExpectedFinishChange: (n: number | null) => void;
}) {
  return (
    <>
      <label className="label-micro" htmlFor={`${idPrefix}event-days`}>
        Days
      </label>
      <input
        id={`${idPrefix}event-days`}
        type="number"
        min={1}
        value={eventDays}
        onChange={(e) =>
          onEventDaysChange(Math.max(1, Number(e.target.value) || 1))
        }
        className="w-full rounded-xl border border-hairline px-3 py-2 text-caption text-ink-primary"
      />

      <label className="label-micro" htmlFor={`${idPrefix}event-distance`}>
        Total distance (km)
      </label>
      <input
        id={`${idPrefix}event-distance`}
        type="number"
        min={0}
        value={distanceKm ?? ""}
        onChange={(e) =>
          onDistanceChange(
            e.target.value === "" ? null : Number(e.target.value)
          )
        }
        className="w-full rounded-xl border border-hairline px-3 py-2 text-caption text-ink-primary"
      />

      <label className="label-micro" htmlFor={`${idPrefix}event-elevation`}>
        Total elevation (m)
      </label>
      <input
        id={`${idPrefix}event-elevation`}
        type="number"
        min={0}
        value={elevationM ?? ""}
        onChange={(e) =>
          onElevationChange(
            e.target.value === "" ? null : Number(e.target.value)
          )
        }
        className="w-full rounded-xl border border-hairline px-3 py-2 text-caption text-ink-primary"
      />

      <label className="label-micro" htmlFor={`${idPrefix}expected-finish`}>
        Expected finish time (hours, optional)
      </label>
      <input
        id={`${idPrefix}expected-finish`}
        type="number"
        min={0}
        step={0.25}
        value={expectedFinishHours ?? ""}
        onChange={(e) =>
          onExpectedFinishChange(
            e.target.value === "" ? null : Number(e.target.value)
          )
        }
        className="w-full rounded-xl border border-hairline px-3 py-2 text-caption text-ink-primary"
      />
      <p className="mt-1 text-label text-ink-muted">
        If you know roughly how long this takes you, this beats every estimate
        we can make.
      </p>

      {eventDays > 1 && (
        <details className="mt-3">
          <summary className="label-micro cursor-pointer">
            Per-day detail (optional)
          </summary>
          <p className="mt-1 text-label text-ink-muted">
            Enter each day and we can tell you what your longest training ride
            needs to be. Without it we assume every day is the average.
          </p>
          {Array.from({ length: eventDays }, (_, i) => (
            <div key={i} className="mt-2 flex items-center gap-2">
              <span className="w-12 text-label text-ink-muted">{`Day ${i + 1}`}</span>
              <input
                aria-label={`${ariaPrefix}Day ${i + 1} distance in km`}
                type="number"
                min={0}
                value={stages[i]?.distanceKm ?? ""}
                onChange={(e) => onStageChange(i, "distanceKm", e.target.value)}
                className="w-24 rounded-lg border border-hairline px-2 py-1 text-label text-ink-primary"
              />
              <input
                aria-label={`${ariaPrefix}Day ${i + 1} elevation in m`}
                type="number"
                min={0}
                value={stages[i]?.elevationM ?? ""}
                onChange={(e) => onStageChange(i, "elevationM", e.target.value)}
                className="w-24 rounded-lg border border-hairline px-2 py-1 text-label text-ink-primary"
              />
            </div>
          ))}
        </details>
      )}
    </>
  );
}

/**
 * Inline "correct a typo" path for an existing race's demand — Finding I6
 * part 2. Reuses DemandFields with its own local state seeded from the
 * race's stored values, rather than the add form's dead-after-submit state.
 */
function RaceDemandEditor({
  race,
  onCancel,
  onSaved,
}: {
  race: RaceListItem;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [sport, setSport] = useState<PlanSport>(race.sport);
  const [eventDays, setEventDays] = useState(race.eventDays);
  const [distanceKm, setDistanceKm] = useState<number | null>(race.distanceKm);
  const [elevationM, setElevationM] = useState<number | null>(race.elevationM);
  const [expectedFinishHours, setExpectedFinishHours] = useState<number | null>(
    race.expectedFinishHours
  );
  const [goalNote, setGoalNote] = useState(race.goalNote ?? "");
  const [stages, setStages] = useState<
    { distanceKm: number | null; elevationM: number | null }[]
  >(
    Array.from({ length: race.eventDays }, (_, i) => {
      const s = race.stages.find((s) => s.dayNumber === i + 1);
      return {
        distanceKm: s?.distanceKm ?? null,
        elevationM: s?.elevationM ?? null,
      };
    })
  );

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

  // Same rule as the add form's stagesForSubmit: no per-day detail entered
  // means send none, not a row of nulls per day.
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

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      try {
        const result = await updateRaceDemand(race.id, {
          sport,
          eventDays,
          distanceKm,
          elevationM,
          expectedFinishHours,
          stages: stagesForSubmit(),
          goalNote,
        });
        if (!result.ok) {
          setError(result.error);
          return;
        }
        onSaved();
      } catch {
        // updateRaceDemand is a directly reachable server action — an
        // unexpected throw must not become an unhandled rejection with
        // nothing shown to the athlete.
        setError("Couldn't save that race — please try again.");
      }
    });
  }

  return (
    <form
      onSubmit={handleSubmit}
      aria-label={`Demand form for ${race.name}`}
      className="space-y-3 border-t border-hairline bg-surface-overlay px-5 py-4"
    >
      <SportSelect
        id={`edit-${race.id}-sport`}
        ariaLabel={`Sport for ${race.name}`}
        value={sport}
        onChange={setSport}
      />

      <DemandFields
        idPrefix={`edit-${race.id}-`}
        ariaPrefix={`Edit ${race.name}: `}
        eventDays={eventDays}
        distanceKm={distanceKm}
        elevationM={elevationM}
        stages={stages}
        expectedFinishHours={expectedFinishHours}
        onEventDaysChange={setEventDays}
        onDistanceChange={setDistanceKm}
        onElevationChange={setElevationM}
        onStageChange={setStageField}
        onExpectedFinishChange={setExpectedFinishHours}
      />

      {/* Free text on purpose. The coach reads prose, and goalNote already
          flows to it, to the morning insight and to the race debrief — a
          structured target schema would be guessing at what an athlete
          types before anyone has typed one. */}
      <label className="label-micro" htmlFor={`edit-${race.id}-goal`}>
        Goal
      </label>
      <input
        id={`edit-${race.id}-goal`}
        aria-label={`Goal for ${race.name}`}
        value={goalNote}
        onChange={(e) => setGoalNote(e.target.value)}
        placeholder="What would make this a good day?"
        className="w-full rounded-xl border border-hairline px-3 py-2 text-caption text-ink-primary placeholder:text-ink-muted focus:outline-none"
      />

      <div className="flex gap-2">
        <PendingButton
          type="submit"
          pending={pending}
          pendingLabel="Saving…"
          className="flex-1 rounded-2xl bg-accent py-2.5 text-caption font-bold text-primary-foreground transition-opacity disabled:opacity-50"
        >
          Save
        </PendingButton>
        <button
          type="button"
          disabled={pending}
          onClick={onCancel}
          className="flex-1 rounded-2xl border border-hairline py-2.5 text-caption font-bold text-ink-secondary transition-colors hover:text-ink-primary disabled:opacity-50"
        >
          Cancel
        </button>
      </div>
      {error && (
        <p role="status" className="text-center text-label text-chart-5">
          {error}
        </p>
      )}
    </form>
  );
}

export function RacesSection({ races, hideHeading = false }: Props) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const detailsRef = useRef<HTMLDetailsElement>(null);
  // Which race's demand-edit form is open, if any — Finding I6 part 2.
  const [editingId, setEditingId] = useState<string | null>(null);

  const [eventDays, setEventDays] = useState(1);
  const [distanceKm, setDistanceKm] = useState<number | null>(null);
  const [elevationM, setElevationM] = useState<number | null>(null);
  const [expectedFinishHours, setExpectedFinishHours] = useState<number | null>(
    null
  );
  const [stages, setStages] = useState<
    { distanceKm: number | null; elevationM: number | null }[]
  >([]);

  const [sport, setSport] = useState<PlanSport>("Bike");
  // Pre-fill from what the athlete typed, but never overrule a deliberate
  // choice: the inference only moves the select while it still holds the
  // value the previous inference put there.
  const [sportTouched, setSportTouched] = useState(false);
  function handleRaceTypeChange(raceType: string) {
    if (sportTouched) return;
    const inferred = inferPlanSport(raceType);
    if (inferred) setSport(inferred);
  }

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
    setExpectedFinishHours(null);
    setStages([]);
    setSport("Bike");
    setSportTouched(false);
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
          sport,
          goalNote: goalNote.length > 0 ? goalNote : undefined,
          eventDays,
          distanceKm,
          elevationM,
          expectedFinishHours,
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

  // `border-hairline bg-surface-selected`, not `.glass`, on all three
  // panels below: this section now only ever renders inside the "races"
  // sheet (train/page.tsx), whose own panel is `bg-surface-overlay`.
  // `--glass-bg` resolves to `--surface-raised`, and both equal #ffffff in
  // light — `.glass` would paint an invisible fill behind a bare hairline
  // border there, the same bug ac747af fixed for WeekRationale/
  // EventReadiness and ded5f64 fixed for StandardWeek. `--surface-selected`
  // is the token this repo built for exactly this — a highlight inside a
  // raised/overlay container, distinct from it in both themes.
  return (
    <section className="mb-10">
      {!hideHeading && <p className="label-micro mb-3">Races</p>}

      {races.length === 0 ? (
        <div className="mb-4 rounded-2xl border border-hairline bg-surface-selected p-5">
          <p className="text-caption text-ink-muted">
            No races yet — add one so the plan can taper toward it.
          </p>
        </div>
      ) : (
        <div className="mb-4 overflow-hidden rounded-2xl border border-hairline bg-surface-selected">
          <ul className="divide-y divide-hairline">
            {races.map((race) => (
              <Fragment key={race.id}>
                <li className="flex items-center justify-between gap-3 px-5 py-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span
                        className={`rounded-full border px-2 py-0.5 text-label font-bold uppercase tracking-wider ${PRIORITY_CHIP[race.priority]}`}
                      >
                        {race.priority}
                      </span>
                      <p className="truncate text-caption font-bold text-ink-primary">
                        {race.name}
                      </p>
                    </div>
                    <p className="mt-1 truncate text-label text-ink-muted">
                      {`${race.raceType} · ${race.date}`}
                      {race.goalNote && ` · ${race.goalNote}`}
                    </p>
                    <p className="mt-0.5 truncate text-label text-ink-muted">
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
                      className="rounded-lg border border-hairline px-2 py-1 text-label text-ink-secondary focus:border-accent focus:outline-none disabled:opacity-50"
                    >
                      {(Object.keys(STATUS_LABEL) as RaceStatus[]).map((s) => (
                        <option key={s} value={s}>
                          {STATUS_LABEL[s]}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      aria-label={`Edit demand for ${race.name}`}
                      disabled={pending}
                      onClick={() =>
                        setEditingId((cur) =>
                          cur === race.id ? null : race.id
                        )
                      }
                      className="rounded-full p-2 text-ink-secondary transition-colors hover:bg-surface-overlay hover:text-ink-primary disabled:opacity-50"
                    >
                      <Pencil aria-hidden className="size-4" />
                    </button>
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
                      className="rounded-full p-2 text-ink-secondary transition-colors hover:bg-chart-5/10 hover:text-chart-5 disabled:opacity-50"
                    >
                      <Trash2 aria-hidden className="size-4" />
                    </button>
                  </div>
                </li>
                {editingId === race.id && (
                  <li>
                    <RaceDemandEditor
                      race={race}
                      onCancel={() => setEditingId(null)}
                      onSaved={() => setEditingId(null)}
                    />
                  </li>
                )}
              </Fragment>
            ))}
          </ul>
        </div>
      )}

      <details
        ref={detailsRef}
        className="rounded-2xl border border-hairline bg-surface-selected"
      >
        <summary className="cursor-pointer list-none px-5 py-3 text-label font-bold uppercase tracking-wider text-chart-2">
          + Add race
        </summary>
        <form onSubmit={handleAdd} className="space-y-3 px-5 pb-5">
          <input
            id="race-name"
            name="name"
            required
            placeholder="Race name"
            className="w-full rounded-xl border border-hairline px-3 py-2 text-caption text-ink-primary placeholder:text-ink-muted focus:border-accent focus:outline-none"
          />
          <div className="grid grid-cols-2 gap-3">
            <input
              name="raceType"
              required
              placeholder="Type (e.g. marathon)"
              onChange={(e) => handleRaceTypeChange(e.target.value)}
              className="w-full rounded-xl border border-hairline px-3 py-2 text-caption text-ink-primary placeholder:text-ink-muted focus:border-accent focus:outline-none"
            />
            <select
              name="priority"
              defaultValue="B"
              aria-label="Priority"
              className="w-full rounded-xl border border-hairline px-3 py-2 text-caption text-ink-primary focus:border-accent focus:outline-none"
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
            className="w-full rounded-xl border border-hairline px-3 py-2 text-caption text-ink-primary focus:border-accent focus:outline-none"
          />

          <SportSelect
            id="race-sport"
            ariaLabel="Sport"
            value={sport}
            onChange={(s) => {
              setSport(s);
              setSportTouched(true);
            }}
          />

          <DemandFields
            idPrefix=""
            ariaPrefix=""
            eventDays={eventDays}
            distanceKm={distanceKm}
            elevationM={elevationM}
            stages={stages}
            expectedFinishHours={expectedFinishHours}
            onEventDaysChange={setEventDays}
            onDistanceChange={setDistanceKm}
            onElevationChange={setElevationM}
            onStageChange={setStageField}
            onExpectedFinishChange={setExpectedFinishHours}
          />

          <input
            name="goalNote"
            placeholder="Goal note (optional)"
            className="w-full rounded-xl border border-hairline px-3 py-2 text-caption text-ink-primary placeholder:text-ink-muted focus:border-accent focus:outline-none"
          />
          <PendingButton
            type="submit"
            pending={pending}
            pendingLabel="Adding…"
            className="w-full rounded-2xl bg-accent py-2.5 text-caption font-bold text-primary-foreground transition-opacity disabled:opacity-50"
          >
            Add race
          </PendingButton>
          {error && (
            <p role="status" className="text-center text-label text-chart-5">
              {error}
            </p>
          )}
        </form>
      </details>
    </section>
  );
}
