import { sql } from "drizzle-orm";
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
