import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireUser } from "@/lib/session";
import { getOrFetchActivityDetail } from "@/lib/activity-streams";
import { AppShell } from "@/components/app-shell";
import { StreamChart } from "@/components/activity/stream-chart";
import { LapsTable } from "@/components/activity/laps-table";
import { formatDuration, formatKm } from "@/lib/format";

const paceMinKm = (v: number) => {
  const m = Math.floor(v);
  const s = Math.round((v - m) * 60);
  return `${m}:${String(s).padStart(2, "0")}`;
};

export default async function ActivityPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireUser();
  const { id } = await params;
  const detail = await getOrFetchActivityDetail(user.id, id);
  if (!detail) notFound();
  const { activity, streams, laps, reason } = detail;

  const stats: [string, string][] = [];
  if (activity.durationS != null)
    stats.push(["Duration", formatDuration(activity.durationS)]);
  if (activity.distanceM != null)
    stats.push(["Distance", formatKm(activity.distanceM)]);
  if (activity.load != null)
    stats.push(["Load", String(Math.round(activity.load))]);
  if (activity.avgHr != null)
    stats.push(["Avg HR", String(Math.round(activity.avgHr))]);
  if (activity.avgPower != null)
    stats.push(["Avg Power", `${Math.round(activity.avgPower)} W`]);
  if (activity.elevationM != null)
    stats.push(["Climb", `${Math.round(activity.elevationM)} m`]);

  const pace = streams?.velocity_smooth?.map((v) =>
    v != null && v > 0.5 ? 1000 / 60 / v : null
  );

  return (
    <AppShell>
      <header className="mb-6 pt-8">
        <Link
          href="/log"
          className="mb-4 inline-flex items-center gap-2 text-[11px] font-bold uppercase tracking-widest text-white/50"
        >
          <ArrowLeft className="size-3" /> Performance
        </Link>
        <h1 className="text-2xl font-bold tracking-tighter">
          {activity.name ?? activity.sport}
        </h1>
        <p className="mt-1 text-xs font-medium uppercase tracking-widest text-white/50">
          {activity.sport} ·{" "}
          {activity.startDate.toLocaleDateString("en-US", {
            weekday: "short",
            month: "short",
            day: "numeric",
          })}
        </p>
      </header>

      <div className="space-y-4 pb-12">
        <section className="glass grid grid-cols-3 gap-4 rounded-[2rem] p-6">
          {stats.map(([k, v]) => (
            <div key={k} className="flex flex-col">
              <span className="text-lg font-bold">{v}</span>
              <span className="text-[10px] font-bold uppercase tracking-widest text-white/50">
                {k}
              </span>
            </div>
          ))}
        </section>

        {streams?.heartrate && (
          <StreamChart
            label="Heart rate"
            unit="bpm"
            color="#f87171"
            values={streams.heartrate}
          />
        )}
        {streams?.watts && (
          <StreamChart
            label="Power"
            unit="W"
            color="#a78bfa"
            values={streams.watts}
          />
        )}
        {pace && (
          <StreamChart
            label="Pace"
            unit="/km"
            color="#22d3ee"
            values={pace}
            format={paceMinKm}
          />
        )}
        {streams?.altitude && (
          <StreamChart
            label="Elevation"
            unit="m"
            color="#34d399"
            values={streams.altitude}
          />
        )}

        {laps && laps.length > 0 && <LapsTable laps={laps} />}

        {!streams && (
          <section className="glass rounded-[2rem] p-6 text-sm text-white/50">
            {reason === "fetch_failed"
              ? "Couldn't load detailed data from intervals.icu right now — the summary above is still accurate."
              : "No detailed data available for this activity."}
          </section>
        )}
      </div>
    </AppShell>
  );
}
