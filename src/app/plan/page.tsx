import Link from "next/link";
import { and, asc, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { AppShell } from "@/components/app-shell";
import { IntakeForm } from "@/components/plan/intake-form";
import { WeekStrip } from "@/components/plan/week-strip";
import { RacesSection } from "@/components/plan/races-section";
import { DayActions } from "@/components/plan/day-actions";
import { getOpenWeekPlan, listAdjustments } from "@/lib/week-plan/service";
import { prefillAvailability } from "@/lib/week-plan/availability";
import { listRaces } from "@/lib/race/service";
import type { DaySlot } from "@/lib/week-plan/types";
import {
  fetchBusyTimes,
  getValidGoogleAccessToken,
  type CalendarBusyBlock,
} from "@/lib/connectors/google-calendar";
import { startWeek, submitAvailability } from "./actions";

export const dynamic = "force-dynamic";

function addDaysYmd(ymd: string, n: number): string {
  const d = new Date(ymd + "T00:00:00");
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function dayLabel(ymd: string): string {
  return new Date(ymd + "T00:00:00").toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

/** Total busy minutes per week day (Monday first) from calendar blocks. */
function busyMinsPerDay(
  blocks: CalendarBusyBlock[],
  weekStart: string
): number[] {
  const result = Array.from({ length: 7 }, () => 0);
  for (let i = 0; i < 7; i++) {
    const dayStart = new Date(addDaysYmd(weekStart, i) + "T00:00:00").getTime();
    const dayEnd = dayStart + 86_400_000;
    for (const b of blocks) {
      const s = Math.max(new Date(b.start).getTime(), dayStart);
      const e = Math.min(new Date(b.end).getTime(), dayEnd);
      if (e > s) result[i] += Math.round((e - s) / 60_000);
    }
  }
  return result;
}

const STATUS_CHIP: Record<DaySlot["status"], string> = {
  completed: "border-emerald-400/30 text-emerald-400",
  adapted: "border-amber-400/30 text-amber-400",
  moved: "border-amber-400/30 text-amber-400",
  missed: "border-red-400/30 text-red-400",
  planned: "border-white/15 text-white/60",
  rest: "border-white/10 text-white/35",
  race: "border-fuchsia-400/30 text-fuchsia-300",
};

export default async function PlanPage() {
  const user = await requireUser();

  const plan = await db.query.trainingPlans.findFirst({
    where: and(
      eq(schema.trainingPlans.userId, user.id),
      eq(schema.trainingPlans.status, "active")
    ),
  });

  if (!plan) {
    return (
      <AppShell>
        <header className="mb-8 pt-8">
          <h1 className="text-2xl font-bold tracking-tight text-white/90">
            Plan
          </h1>
        </header>
        <div className="glass rounded-[2rem] p-7">
          <p className="text-sm text-white/70">
            No training plan yet — ask the{" "}
            <Link href="/coach" className="font-bold text-emerald-400">
              coach
            </Link>{" "}
            to generate one.
          </p>
        </div>
      </AppShell>
    );
  }

  const week = await getOpenWeekPlan(user.id);
  const adjustments = week ? await listAdjustments(week.id) : [];
  const races = await listRaces(user.id);

  // Availability intake — only while the week hasn't started completing.
  let intake: { suggested: number[] } | null = null;
  if (week && week.days[0]?.status !== "completed") {
    // Calendar prefill lives here, where a human confirms it — never in
    // the automatic rollover (spec).
    let busy: number[] | null = null;
    const connection = await db.query.connections.findFirst({
      where: and(
        eq(schema.connections.userId, user.id),
        eq(schema.connections.provider, "google_calendar"),
        eq(schema.connections.status, "active")
      ),
    });
    if (connection) {
      try {
        const accessToken = await getValidGoogleAccessToken(connection);
        const blocks = await fetchBusyTimes({
          accessToken,
          startDate: week.weekStart,
          endDate: addDaysYmd(week.weekStart, 7),
        });
        busy = busyMinsPerDay(blocks, week.weekStart);
      } catch {
        busy = null; // calendar is a hint, never a blocker
      }
    }
    const constraints = (plan.constraints ?? {}) as {
      daysPerWeek?: number;
      hoursPerWeek?: number;
    };
    intake = {
      suggested: prefillAvailability({
        hoursPerWeek: constraints.hoursPerWeek ?? 8,
        daysPerWeek: constraints.daysPerWeek ?? 5,
        lastWeekMins: week.days.map((d) => d.availableMins),
        busyMinsPerDay: busy,
      }),
    };
  }

  const blocks = await db.query.trainingBlocks.findMany({
    where: eq(schema.trainingBlocks.planId, plan.id),
    orderBy: [asc(schema.trainingBlocks.weekNumber)],
  });
  const remaining = blocks.filter((b) => b.weekNumber >= plan.currentWeek);
  const openBlock = blocks.find(
    (b) => b.weekNumber === (week?.skeletonWeek ?? plan.currentWeek)
  );

  return (
    <AppShell>
      <header className="mb-8 pt-8">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold tracking-tight text-white/90">
            {plan.title}
          </h1>
          {openBlock?.phase === "taper" && (
            <span className="rounded-full border border-fuchsia-400/30 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-fuchsia-300">
              Taper
            </span>
          )}
        </div>
        <p className="mt-1 text-[12px] text-white/50">
          {`Race ${plan.raceDate} · week ${Math.min(plan.currentWeek, plan.weeksTotal)} of ${plan.weeksTotal}`}
          {openBlock?.phase && ` · ${openBlock.phase} phase`}
        </p>
      </header>

      <RacesSection races={races} />

      {intake && week && (
        <section className="mb-10">
          <IntakeForm
            suggested={intake.suggested}
            action={submitAvailability}
          />
        </section>
      )}

      {week ? (
        <>
          <section className="mb-6">
            <WeekStrip days={week.days} />
          </section>

          <section className="mb-10 space-y-3">
            {week.days.map((d) => (
              <div key={d.date} className="glass rounded-2xl px-5 py-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-[11px] font-bold uppercase tracking-wider text-white/40">
                      {dayLabel(d.date)}
                    </p>
                    {d.workout ? (
                      <p className="mt-1 text-sm font-bold text-white">
                        {`${d.workout.type} · ${d.workout.durationMins} min`}
                        <span className="ml-2 font-normal text-white/50">
                          {d.workout.intensity}
                        </span>
                      </p>
                    ) : d.status === "race" ? (
                      <p className="mt-1 text-sm font-bold text-fuchsia-300">
                        {`🏁 ${d.raceName ?? "Race day"}`}
                      </p>
                    ) : (
                      <p className="mt-1 text-sm font-bold text-white/50">
                        Rest
                      </p>
                    )}
                    {d.movedFrom && (
                      <p className="mt-0.5 text-[11px] text-amber-400/80">
                        {`moved from ${d.movedFrom}`}
                      </p>
                    )}
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <span
                      className={`rounded-full border px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${STATUS_CHIP[d.status]}`}
                    >
                      {d.status}
                    </span>
                    <span className="text-[11px] text-white/40">
                      {`${d.availableMins} min free`}
                    </span>
                  </div>
                </div>
                {d.workout && (
                  <DayActions
                    day={{ date: d.date, hasWorkout: true }}
                    otherDays={week.days
                      .filter((o) => o.date !== d.date)
                      .map((o) => ({
                        date: o.date,
                        hasWorkout: o.workout !== null,
                        isRace: o.status === "race",
                      }))}
                  />
                )}
              </div>
            ))}
          </section>

          {adjustments.length > 0 && (
            <section className="mb-10">
              <p className="label-micro mb-3">What changed and why</p>
              <div className="glass rounded-[2rem] p-6">
                <ul className="space-y-3">
                  {adjustments.map((a) => (
                    <li key={a.id} className="flex gap-3">
                      <span aria-hidden className="text-white/30">
                        ↻
                      </span>
                      <div>
                        <p className="text-[13px] text-white/80">{a.reason}</p>
                        <p className="mt-0.5 text-[11px] text-white/35">
                          {a.createdAt.toLocaleString("en-US", {
                            month: "short",
                            day: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            </section>
          )}
        </>
      ) : (
        <section className="mb-10">
          <form action={startWeek} className="glass rounded-[2rem] p-7">
            <p className="text-sm text-white/70">
              This week hasn&apos;t been planned yet. Start it now and it
              materializes from your skeleton — you can adjust your availability
              right after.
            </p>
            <button
              type="submit"
              className="mt-5 w-full rounded-2xl bg-emerald-500/90 py-3 text-sm font-bold text-neutral-950 transition-opacity hover:opacity-90"
            >
              Plan this week
            </button>
          </form>
        </section>
      )}

      {remaining.length > 0 && (
        <section className="mb-10">
          <p className="label-micro mb-3">Remaining skeleton</p>
          <div className="glass overflow-hidden rounded-[2rem]">
            <table className="w-full text-left text-[13px]">
              <thead>
                <tr className="border-b border-white/5 text-[10px] font-bold uppercase tracking-wider text-white/40">
                  <th className="px-5 py-3">Week</th>
                  <th className="px-5 py-3">Phase</th>
                  <th className="px-5 py-3 text-right">Target load</th>
                </tr>
              </thead>
              <tbody>
                {remaining.map((b) => (
                  <tr
                    key={b.weekNumber}
                    className="border-b border-white/5 last:border-0"
                  >
                    <td className="px-5 py-3 font-bold text-white/80">
                      {b.weekNumber}
                    </td>
                    <td className="px-5 py-3 capitalize text-white/60">
                      {b.phase}
                    </td>
                    <td className="px-5 py-3 text-right text-white/60">
                      {b.targetLoadTotal != null
                        ? Math.round(b.targetLoadTotal)
                        : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </AppShell>
  );
}
