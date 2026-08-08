import { lt, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { localYmd } from "@/lib/charts";
import { logger } from "@/lib/logger";

/**
 * Every surface the app records a view for. A closed set, not raw pathnames:
 * `/activity/[id]` as a pathname would produce one key per activity and make
 * the table unbounded. Adding a page means adding a key here deliberately.
 */
export const SURFACES = [
  "today",
  "train",
  "coach",
  "body",
  "settings",
  "admin",
  "import",
  "activity",
  "activity-log",
] as const;

export type Surface = (typeof SURFACES)[number];

/**
 * Increment today's counter for one surface. Local-only; nothing leaves the
 * instance.
 *
 * Deliberately swallows its own errors: this runs inside a page render, and a
 * telemetry write must never be the reason an athlete sees a 500. A missing
 * count is a smaller loss than a broken page.
 */
export async function recordSurfaceView(
  userId: string,
  surface: Surface
): Promise<void> {
  try {
    await db
      .insert(schema.surfaceViews)
      .values({ userId, surface, day: localYmd(new Date()), count: 1 })
      .onConflictDoUpdate({
        target: [
          schema.surfaceViews.userId,
          schema.surfaceViews.surface,
          schema.surfaceViews.day,
        ],
        set: { count: sql`${schema.surfaceViews.count} + 1` },
      });
  } catch (err) {
    logger.warn("surface view not recorded", {
      surface,
      message: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Drop counts older than the retention window. Bounded growth matters here
 * because the table gains a row per surface per day per user forever
 * otherwise. Returns the number of rows removed.
 */
export async function pruneSurfaceViews(
  olderThanDays: number
): Promise<number> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - olderThanDays);
  const deleted = await db
    .delete(schema.surfaceViews)
    .where(lt(schema.surfaceViews.day, localYmd(cutoff)))
    .returning();
  return deleted.length;
}

/**
 * Owner-only, cross-user aggregate: total views per surface across every
 * user, sorted descending. Not scoped to any one user — this powers the
 * instance-wide `/admin` card, not a per-athlete figure.
 *
 * Note: counts observed while running `npm run dev` locally may look
 * inflated relative to actual clicks — Next.js `<Link>` prefetching can
 * complete real requests against sibling routes under `next dev`, each one
 * recording a view. Verified absent under a production build (`next build`
 * + `next start`): there, prefetch requests to routes not actually visited
 * are cancelled before the page executes.
 */
export async function surfaceViewTotals(): Promise<
  { surface: string; total: number }[]
> {
  return db
    .select({
      surface: schema.surfaceViews.surface,
      total: sql<number>`sum(${schema.surfaceViews.count})::int`,
    })
    .from(schema.surfaceViews)
    .groupBy(schema.surfaceViews.surface)
    .orderBy(sql`sum(${schema.surfaceViews.count}) desc`);
}
