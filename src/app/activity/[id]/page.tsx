import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireUser } from "@/lib/session";
import { recordSurfaceView } from "@/lib/telemetry";
import { getOrFetchActivityDetail } from "@/lib/activity-streams";
import { AppShell, shellUser } from "@/components/app-shell";
import { StreamChart } from "@/components/activity/stream-chart";
import { LapsTable } from "@/components/activity/laps-table";
import { StreamDataEmpty } from "@/components/activity/stream-data-empty";
import { ActivityDebriefSection } from "@/components/debrief/activity-debrief-section";
import { DeleteActivityButton } from "@/components/activity/delete-activity-button";
import { chartFill, STREAM_COLORS } from "@/lib/charts";
import { activityStats, activityMeta } from "@/lib/activity-stats";

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
  await recordSurfaceView(user.id, "activity");
  const { id } = await params;
  const detail = await getOrFetchActivityDetail(user.id, id);
  if (!detail) notFound();
  const { activity, streams, laps, reason } = detail;

  // One owner, shared with Today's "just landed" block — see
  // src/lib/activity-stats.ts for why these stopped being two literals.
  const stats = activityStats(activity);

  const pace = streams?.velocity_smooth?.map((v) =>
    v != null && v > 0.5 ? 1000 / 60 / v : null
  );

  return (
    <AppShell user={shellUser(user)}>
      <header className="mb-5 pt-8">
        <Link
          href="/train?tab=history"
          className="mb-3 inline-flex items-center gap-1.5 text-label font-bold uppercase tracking-[0.15em] text-ink-secondary transition-colors hover:text-ink-primary"
        >
          <ArrowLeft aria-hidden className="size-3" /> Train / History
        </Link>
        <div className="flex items-start justify-between gap-3">
          <h1 className="text-title font-bold tracking-[-0.03em]">
            {activity.name ?? activity.sport}
          </h1>
          <DeleteActivityButton
            activityId={id}
            activityName={activity.name ?? activity.sport}
          />
        </div>
        <p className="mt-1 text-label font-bold uppercase tracking-[0.15em] text-ink-secondary">
          {activityMeta(activity)}
        </p>
      </header>

      <div className="space-y-3 pb-12">
        {/* 3×2 tiles (2b) — the glass stats card broken into its parts. */}
        <section className="grid grid-cols-3 gap-2">
          {stats.map((s) => (
            <div
              key={s.label}
              className="rounded-[14px] border border-hairline bg-surface-raised px-3 py-2.5"
            >
              <p className="font-mono text-caption font-bold leading-none text-ink-primary">
                {s.value}
                {s.unit && (
                  <span className="ml-0.5 text-label font-medium text-ink-muted">
                    {s.unit}
                  </span>
                )}
              </p>
              <p className="mt-1.5 text-label font-bold uppercase text-ink-muted">
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
            color={STREAM_COLORS.heartrate}
            values={streams.heartrate}
          />
        )}
        {streams?.watts && (
          <StreamChart
            label="Power"
            unit="W"
            color={STREAM_COLORS.power}
            values={streams.watts}
          />
        )}
        {pace && (
          <StreamChart
            label="Pace"
            unit="/km"
            color={STREAM_COLORS.pace}
            values={pace}
            format={paceMinKm}
          />
        )}
        {streams?.altitude && (
          <StreamChart
            label="Elevation"
            unit="m"
            color={STREAM_COLORS.elevation}
            values={streams.altitude}
            height={44}
            fill={chartFill(STREAM_COLORS.elevation, 0.15)}
          />
        )}

        {laps && laps.length > 0 && <LapsTable laps={laps} />}

        {!streams && <StreamDataEmpty reason={reason} />}
      </div>
    </AppShell>
  );
}
