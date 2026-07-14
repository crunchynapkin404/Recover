import { headers } from "next/headers";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db, schema } from "@/lib/db";

export const dynamic = "force-dynamic";

/** Full personal-data export (JSON download) — the athlete owns their data. */
export async function GET() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return new Response("Unauthorized", { status: 401 });
  const userId = session.user.id;

  const [wellness, activities, metrics, threads] = await Promise.all([
    db.query.wellnessDaily.findMany({
      where: eq(schema.wellnessDaily.userId, userId),
      orderBy: schema.wellnessDaily.date,
    }),
    db.query.activities.findMany({
      where: eq(schema.activities.userId, userId),
      orderBy: schema.activities.startDate,
    }),
    db.query.dailyMetrics.findMany({
      where: eq(schema.dailyMetrics.userId, userId),
      orderBy: schema.dailyMetrics.date,
    }),
    db.query.chatThreads.findMany({
      where: eq(schema.chatThreads.userId, userId),
    }),
  ]);

  const body = JSON.stringify(
    {
      exported_at: new Date().toISOString(),
      user: { email: session.user.email, name: session.user.name },
      wellness_daily: wellness,
      activities: activities.map((a) => ({ ...a, raw: undefined })),
      daily_metrics: metrics,
      chat_threads: threads,
    },
    null,
    2
  );

  return new Response(body, {
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="recover-export-${new Date().toISOString().slice(0, 10)}.json"`,
    },
  });
}
