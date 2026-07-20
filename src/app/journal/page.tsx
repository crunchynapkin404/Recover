import { and, desc, eq, gte } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { AppShell } from "@/components/app-shell";
import { JournalForm } from "@/components/journal/journal-form";
import { CorrelationInsights } from "@/components/journal/correlation-insights";
import { computeTagInsights } from "@/lib/insights/correlations";
import { MilestonesCard } from "@/components/dashboard/milestones-card";
import { getMilestones } from "@/lib/insights/milestones";
import type { DayFlag } from "@/lib/day-flags";

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

export default async function JournalPage() {
  const user = await requireUser();

  const latest = await db.query.wellnessDaily.findFirst({
    where: eq(schema.wellnessDaily.userId, user.id),
    orderBy: desc(schema.wellnessDaily.date),
  });

  // Fetch entries for the last 5 days so the form can restore state per day.
  const recentEntries = await db.query.wellnessDaily.findMany({
    where: and(
      eq(schema.wellnessDaily.userId, user.id),
      gte(schema.wellnessDaily.date, daysAgo(4))
    ),
    orderBy: desc(schema.wellnessDaily.date),
  });

  const entriesByDate: Record<
    string,
    {
      energy: number | null;
      soreness: number | null;
      stress: number | null;
      mood: string | null;
      tags: string[] | null;
      dayFlags: DayFlag[] | null;
      notes: string | null;
    }
  > = {};
  for (const entry of recentEntries) {
    entriesByDate[entry.date] = {
      energy: entry.energy1_10,
      soreness: entry.soreness1_10,
      stress: entry.stress1_10,
      mood: entry.mood,
      tags: entry.tags,
      dayFlags: entry.dayFlags,
      notes: entry.notes,
    };
  }

  const milestones = await getMilestones(user.id);

  const activeConnection = await db.query.connections.findFirst({
    where: and(
      eq(schema.connections.userId, user.id),
      eq(schema.connections.status, "active")
    ),
    columns: { id: true },
  });

  const insights = await computeTagInsights(user.id);

  return (
    <AppShell>
      <section className="mb-8">
        <CorrelationInsights insights={insights} />
      </section>
      <JournalForm
        syncedHrv={latest?.hrvMs ?? null}
        syncedRhr={latest?.restingHr ?? null}
        syncedWeight={latest?.weightKg ?? null}
        syncedSleepHours={
          latest?.sleepSecs != null ? latest.sleepSecs / 3600 : null
        }
        streakDays={milestones.currentStreak}
        entriesByDate={entriesByDate}
        hasActiveConnection={!!activeConnection}
      />
      <section className="mt-8">
        <MilestonesCard {...milestones} />
      </section>
    </AppShell>
  );
}
