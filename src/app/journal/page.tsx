import { and, desc, eq, gte, isNotNull, or, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { AppShell } from "@/components/app-shell";
import { JournalForm } from "@/components/journal/journal-form";
import { CorrelationInsights } from "@/components/journal/correlation-insights";
import { computeTagCorrelations } from "@/lib/correlations";

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
      notes: entry.notes,
    };
  }

  // Real streak: days in the last 7 with any journal signal.
  const journaled = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.wellnessDaily)
    .where(
      and(
        eq(schema.wellnessDaily.userId, user.id),
        gte(schema.wellnessDaily.date, daysAgo(6)),
        or(
          isNotNull(schema.wellnessDaily.mood),
          isNotNull(schema.wellnessDaily.tags),
          isNotNull(schema.wellnessDaily.notes),
          isNotNull(schema.wellnessDaily.energy1_10)
        )
      )
    );
  const streakDays = journaled[0]?.count ?? 0;

  const correlations = await computeTagCorrelations(user.id);

  return (
    <AppShell>
      <JournalForm
        syncedHrv={latest?.hrvMs ?? null}
        syncedRhr={latest?.restingHr ?? null}
        syncedWeight={latest?.weightKg ?? null}
        syncedSleepHours={
          latest?.sleepSecs != null ? latest.sleepSecs / 3600 : null
        }
        streakDays={streakDays}
        entriesByDate={entriesByDate}
      />
      <section className="mt-8">
        <CorrelationInsights correlations={correlations} />
      </section>
    </AppShell>
  );
}
