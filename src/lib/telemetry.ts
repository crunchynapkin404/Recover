import { lt, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { localYmd } from "@/lib/charts";
import { logger } from "@/lib/logger";
import { BODY_TABS, TRAIN_TABS } from "@/lib/log-href";

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
 * The tabs each tabbed surface may report, keyed by surface.
 *
 * Two of the nine surfaces above are not one screen. Train is four tabs
 * behind `/train` and Body is four behind `/body`, and until v0.121 the
 * counter could not tell them apart: `recordSurfaceView(id, "body")` fired
 * identically whether the athlete opened Trends or Labs. Phase 6's IA
 * inventory (docs/2026-08-26-ia-inventory.md) measured those eight tabs at
 * between 1.0 and 4.7 screens of content and found the nav treating them as
 * peers — a question the counter had no data to answer, because the closed
 * set stopped at the route.
 *
 * The lists are IMPORTED, not restated. `TRAIN_TABS` and `BODY_TABS` in
 * log-href.ts are what the tab rows and the href builders already read; a
 * second copy here would be a set that drifts silently the first time a tab
 * is added, and the drift would show up as a tab that is navigable but
 * uncounted.
 */
export const SURFACE_TABS = {
  train: TRAIN_TABS,
  body: BODY_TABS,
} as const satisfies Partial<Record<Surface, readonly string[]>>;

/** A surface that has tabs — the keys of SURFACE_TABS. */
export type TabbedSurface = keyof typeof SURFACE_TABS;

/** The tabs `S` accepts, or `never` for the surfaces that have none. */
export type SurfaceTab<S extends Surface> = S extends TabbedSurface
  ? (typeof SURFACE_TABS)[S][number]
  : never;

/**
 * The stored key for a surface/tab pair: `body` alone, or `body:labs`.
 *
 * Colon-joined rather than a second column because `surface_views` is keyed
 * on `(user_id, surface, day)` and widening that key is a migration on a
 * table that exists to be cheap. `surface` is already `text` (schema.ts:659),
 * so this needs none.
 */
export function surfaceKey(surface: Surface, tab?: string): string {
  return tab ? `${surface}:${tab}` : surface;
}

/**
 * Every key `recordSurfaceView` can now write — the closed set the
 * instrumentation test checks against. Nine surfaces, eight of which are one
 * screen, plus the eight tabs of the two that are not.
 *
 * Note that `train` and `body` remain in this set although no call site
 * passes them bare any more. Rows written before v0.121 carry them, and
 * `surfaceViewTotals` reads what is stored rather than what is currently
 * written — dropping them here would make a real historical row fail a
 * membership check that exists to catch typos.
 */
export function surfaceViewKeys(): string[] {
  return [
    ...SURFACES,
    ...Object.entries(SURFACE_TABS).flatMap(([surface, tabs]) =>
      tabs.map((tab) => surfaceKey(surface as Surface, tab))
    ),
  ];
}

/**
 * Increment today's counter for one surface. Local-only; nothing leaves the
 * instance.
 *
 * `tab` is typed against the surface it belongs to, so `("body", "season")`
 * does not compile — the pairing is checked where it is written rather than
 * validated after the fact against a table of strings.
 *
 * Deliberately swallows its own errors: this runs inside a page render, and a
 * telemetry write must never be the reason an athlete sees a 500. A missing
 * count is a smaller loss than a broken page.
 */
export async function recordSurfaceView<S extends Surface>(
  userId: string,
  surface: S,
  tab?: SurfaceTab<S>
): Promise<void> {
  const key = surfaceKey(surface, tab);
  try {
    await db
      .insert(schema.surfaceViews)
      .values({ userId, surface: key, day: localYmd(new Date()), count: 1 })
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
      surface: key,
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
