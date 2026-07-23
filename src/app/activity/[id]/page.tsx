import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireUser } from "@/lib/session";
import { getOrFetchActivityDetail } from "@/lib/activity-streams";
import { AppShell } from "@/components/app-shell";
import { StreamChart } from "@/components/activity/stream-chart";
import { LapsTable } from "@/components/activity/laps-table";
import { StreamDataEmpty } from "@/components/activity/stream-data-empty";
import { ActivityDebriefSection } from "@/components/debrief/activity-debrief-section";
import { formatDuration } from "@/lib/format";

// Provenance, spelled the way the athlete would recognise it.
const PROVIDER_LABEL: Record<string, string> = {
  intervals_icu: "intervals.icu",
  strava: "Strava",
  manual: "logged by hand",
};

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

  // Value + its unit are separate so the tile can set the unit smaller —
  // only stats the activity actually carries are pushed.
  const stats: { label: string; value: string; unit?: string }[] = [];
  if (activity.durationS != null)
    stats.push({
      label: "Duration",
      value: formatDuration(activity.durationS),
    });
  if (activity.distanceM != null)
    stats.push({
      label: "Distance",
      value: (activity.distanceM / 1000).toFixed(1),
      unit: "km",
    });
  if (activity.load != null)
    stats.push({ label: "Load", value: String(Math.round(activity.load)) });
  if (activity.avgHr != null)
    stats.push({
      label: "Avg HR",
      value: String(Math.round(activity.avgHr)),
      unit: "bpm",
    });
  if (activity.avgPower != null)
    stats.push({
      label: "Avg Power",
      value: String(Math.round(activity.avgPower)),
      unit: "W",
    });
  if (activity.elevationM != null)
    stats.push({
      label: "Climb",
      value: String(Math.round(activity.elevationM)),
      unit: "m",
    });

  const pace = streams?.velocity_smooth?.map((v) =>
    v != null && v > 0.5 ? 1000 / 60 / v : null
  );

  return (
    <AppShell>
      <header className="mb-5 pt-8">
        <Link
          href="/train?tab=history"
          className="mb-3 inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.15em] text-white/50 transition-colors hover:text-white/80"
        >
          <ArrowLeft aria-hidden className="size-3" /> Train / History
        </Link>
        <h1 className="text-[21px] font-bold tracking-[-0.03em]">
          {activity.name ?? activity.sport}
        </h1>
        <p className="mt-1 text-[9.5px] font-bold uppercase tracking-[0.15em] text-white/40">
          {[
            activity.sport,
            activity.startDate.toLocaleDateString("en-US", {
              weekday: "short",
              month: "short",
              day: "numeric",
            }),
            PROVIDER_LABEL[activity.provider] ?? activity.provider,
          ].join(" · ")}
        </p>
      </header>

      <div className="space-y-3 pb-12">
        {/* 3×2 tiles (2b) — the glass stats card broken into its parts. */}
        <section className="grid grid-cols-3 gap-2">
          {stats.map((s) => (
            <div
              key={s.label}
              className="rounded-[14px] border border-white/[0.09] bg-white/[0.04] px-3 py-2.5"
            >
              <p className="font-mono text-[14px] font-bold leading-none text-white">
                {s.value}
                {s.unit && (
                  <span className="ml-0.5 text-[10px] font-medium text-white/40">
                    {s.unit}
                  </span>
                )}
              </p>
              <p className="mt-1.5 text-[8.5px] font-bold uppercase tracking-[0.15em] text-white/40">
                {s.label}
              </p>
            </div>
          ))}
        </section>

        <ActivityDebriefSection activityId={id} userId={user.id} />

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
            height={44}
            fill="rgba(52,211,153,0.15)"
          />
        )}

        {laps && laps.length > 0 && <LapsTable laps={laps} />}

        {!streams && <StreamDataEmpty reason={reason} />}
      </div>
    </AppShell>
  );
}
