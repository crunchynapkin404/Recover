import { and, eq, gte, isNotNull } from "drizzle-orm";
import { db, schema } from "@/lib/db";

export interface TagCorrelation {
  emoji: string;
  behavior: string;
  impact: string; // e.g. "+11%"
  positive: boolean;
  events: number;
}

const MIN_EVENTS = 5;
const WINDOW_DAYS = 90;

function addDays(ymd: string, days: number): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function splitTag(tag: string): { emoji: string; behavior: string } {
  const match = tag.match(/^(\p{Extended_Pictographic}️?)\s*(.*)$/u);
  if (match) return { emoji: match[1], behavior: match[2] || tag };
  return { emoji: "🏷️", behavior: tag };
}

/**
 * Real behavior→readiness correlations: for each journal tag, compare mean
 * NEXT-day readiness after tagged days against the athlete's overall mean.
 * Only tags with ≥ MIN_EVENTS scored occurrences are reported — everything
 * else is honest "not enough data yet".
 */
export async function computeTagCorrelations(
  userId: string
): Promise<TagCorrelation[]> {
  const since = addDays(new Date().toISOString().slice(0, 10), -WINDOW_DAYS);

  const [tagged, metrics] = await Promise.all([
    db.query.wellnessDaily.findMany({
      where: and(
        eq(schema.wellnessDaily.userId, userId),
        gte(schema.wellnessDaily.date, since),
        isNotNull(schema.wellnessDaily.tags)
      ),
      columns: { date: true, tags: true },
    }),
    db.query.dailyMetrics.findMany({
      where: and(
        eq(schema.dailyMetrics.userId, userId),
        gte(schema.dailyMetrics.date, since),
        isNotNull(schema.dailyMetrics.readiness)
      ),
      columns: { date: true, readiness: true },
    }),
  ]);

  if (metrics.length === 0) return [];

  const readinessByDate = new Map(metrics.map((m) => [m.date, m.readiness!]));
  const overallMean =
    metrics.reduce((a, m) => a + m.readiness!, 0) / metrics.length;
  if (overallMean <= 0) return [];

  const byTag = new Map<string, number[]>();
  for (const day of tagged) {
    const nextDay = readinessByDate.get(addDays(day.date, 1));
    if (nextDay == null) continue;
    for (const tag of day.tags ?? []) {
      const list = byTag.get(tag) ?? [];
      list.push(nextDay);
      byTag.set(tag, list);
    }
  }

  const out: TagCorrelation[] = [];
  for (const [tag, values] of byTag) {
    if (values.length < MIN_EVENTS) continue;
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const impactPct = Math.round(((mean - overallMean) / overallMean) * 100);
    if (impactPct === 0) continue;
    const { emoji, behavior } = splitTag(tag);
    out.push({
      emoji,
      behavior,
      impact: `${impactPct > 0 ? "+" : ""}${impactPct}%`,
      positive: impactPct > 0,
      events: values.length,
    });
  }

  return out.sort(
    (a, b) => Math.abs(parseInt(b.impact)) - Math.abs(parseInt(a.impact))
  );
}
