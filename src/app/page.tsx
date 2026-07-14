import Link from "next/link";
import { and, desc, eq, gte } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { TrendChart } from "@/components/charts/trend-chart";
import { FitnessChart } from "@/components/charts/fitness-chart";
import { SleepChart } from "@/components/charts/sleep-chart";
import {
  formatDay,
  formatDuration,
  formatKm,
  formatSleepHours,
} from "@/lib/format";

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

export default async function DashboardPage() {
  const user = await requireUser();

  const connection = await db.query.connections.findFirst({
    where: and(
      eq(schema.connections.userId, user.id),
      eq(schema.connections.provider, "intervals_icu")
    ),
  });

  const wellness = await db.query.wellnessDaily.findMany({
    where: and(
      eq(schema.wellnessDaily.userId, user.id),
      gte(schema.wellnessDaily.date, daysAgo(90))
    ),
    orderBy: schema.wellnessDaily.date,
  });

  const recentActivities = await db.query.activities.findMany({
    where: eq(schema.activities.userId, user.id),
    orderBy: desc(schema.activities.startDate),
    limit: 8,
  });

  if (!connection && wellness.length === 0) {
    return (
      <AppShell title="Dashboard">
        <Card className="mx-auto max-w-md">
          <CardHeader>
            <CardTitle>Welcome to Recover</CardTitle>
            <CardDescription>
              Connect intervals.icu to pull in your wellness (HRV, resting HR,
              sleep) and training data.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button render={<Link href="/settings" />} nativeButton={false}>
              Connect intervals.icu
            </Button>
          </CardContent>
        </Card>
      </AppShell>
    );
  }

  const latest = [...wellness]
    .reverse()
    .find((w) => w.hrvMs != null || w.restingHr != null);
  const window30 = wellness.filter((w) => w.date >= daysAgo(30));

  const hrvData = window30.map((w) => ({ date: w.date, value: w.hrvMs }));
  const rhrData = window30.map((w) => ({ date: w.date, value: w.restingHr }));
  const sleepData = window30.map((w) => ({
    date: w.date,
    hours: w.sleepSecs != null ? w.sleepSecs / 3600 : null,
  }));
  const fitnessData = wellness.map((w) => ({
    date: w.date,
    ctl: w.ctl,
    atl: w.atl,
  }));

  const tiles = [
    {
      label: "HRV (rMSSD)",
      value: latest?.hrvMs != null ? `${Math.round(latest.hrvMs)} ms` : "—",
    },
    {
      label: "Resting HR",
      value:
        latest?.restingHr != null ? `${Math.round(latest.restingHr)} bpm` : "—",
    },
    { label: "Sleep", value: formatSleepHours(latest?.sleepSecs ?? null) },
    {
      label: "Fitness (CTL)",
      value: latest?.ctl != null ? latest.ctl.toFixed(0) : "—",
    },
  ];

  return (
    <AppShell title="Dashboard">
      <div className="grid gap-6">
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          {tiles.map((tile) => (
            <Card key={tile.label} className="py-4">
              <CardContent className="px-4">
                <p className="text-xs text-muted-foreground">{tile.label}</p>
                <p className="mt-1 text-2xl font-semibold tracking-tight">
                  {tile.value}
                </p>
                {latest && (
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {formatDay(latest.date)}
                  </p>
                )}
              </CardContent>
            </Card>
          ))}
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">HRV — last 30 days</CardTitle>
            </CardHeader>
            <CardContent>
              <TrendChart
                data={hrvData}
                color="var(--viz-series-1)"
                unit="ms"
              />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                Resting HR — last 30 days
              </CardTitle>
            </CardHeader>
            <CardContent>
              <TrendChart
                data={rhrData}
                color="var(--viz-series-3)"
                unit="bpm"
              />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Sleep — last 30 days</CardTitle>
            </CardHeader>
            <CardContent>
              <SleepChart data={sleepData} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                Training load — last 90 days
              </CardTitle>
            </CardHeader>
            <CardContent>
              <FitnessChart data={fitnessData} />
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Recent activities</CardTitle>
          </CardHeader>
          <CardContent>
            {recentActivities.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No activities synced yet.
              </p>
            ) : (
              <ul className="divide-y">
                {recentActivities.map((a) => (
                  <li
                    key={a.id}
                    className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2.5"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">
                        {a.name ?? a.sport}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {a.sport} · {formatDay(a.startDate)}
                      </p>
                    </div>
                    <p className="text-sm tabular-nums text-muted-foreground">
                      {formatDuration(a.durationS)}
                      {a.distanceM != null && <> · {formatKm(a.distanceM)}</>}
                      {a.load != null && <> · load {Math.round(a.load)}</>}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
