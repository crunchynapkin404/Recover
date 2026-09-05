import { and, desc, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import {
  feelFromIcu,
  formatActivityMetrics,
  rpeFromRaw,
} from "@/lib/debrief/lifecycle";
import { DebriefSheet } from "./debrief-sheet";
import { InlineMarkdown } from "@/components/ui/inline-markdown";

/**
 * The pending debrief, as a sheet over the ride's own page.
 *
 * SEPARATE FROM THE CARD BELOW BECAUSE THE TWO GO IN DIFFERENT SLOTS. This is
 * a modal, so it belongs in AppShell's `overlay` — a sibling of
 * `[data-app-background]`, the element BottomSheet marks `inert` while it is
 * open. Returned among the page's children instead (as it was from v0.125.0,
 * the release that moved `inert` into BottomSheet), the sheet lands INSIDE
 * that subtree and `inert` covers it too: RPE, feel, note, Save, Skip and the
 * close scrim all dead, and no way to dismiss it. See
 * tests/sheet-slot-guard.test.ts.
 *
 * Takes the activity row the page has already fetched rather than querying
 * again — the page owns the ownership check that used to live here.
 */
export function ActivityDebriefSheet({
  activity,
}: {
  activity: typeof schema.activities.$inferSelect;
}) {
  if (activity.debriefState !== "pending") return null;
  const raw = activity.raw as Record<string, unknown> | null;
  return (
    <DebriefSheet
      activityId={activity.id}
      activityName={activity.name ?? activity.sport}
      metrics={formatActivityMetrics(activity)}
      prefillRpe={rpeFromRaw(raw)}
      prefillFeel={feelFromIcu(raw?.feel)}
      closeHref={`/activity/${activity.id}`}
    />
  );
}

export async function ActivityDebriefSection({
  activityId,
  userId,
}: {
  activityId: string;
  userId: string;
}) {
  const a = await db.query.activities.findFirst({
    where: and(
      eq(schema.activities.id, activityId),
      eq(schema.activities.userId, userId)
    ),
  });
  if (!a || a.debriefState == null) return null;

  // The prompt is a sheet, and it is rendered by ActivityDebriefSheet from
  // the page's `overlay` slot. Nothing in the flow of the page while it is
  // still open.
  if (a.debriefState === "pending") return null;

  const review = a.debriefThreadId
    ? await db.query.chatMessages.findFirst({
        where: and(
          eq(schema.chatMessages.threadId, a.debriefThreadId),
          eq(schema.chatMessages.role, "assistant")
        ),
        orderBy: [desc(schema.chatMessages.createdAt)],
      })
    : null;

  // "RPE 7 · felt normal", or the honest absence of an answer.
  const answer =
    a.debriefState === "answered"
      ? [
          a.perceivedExertion != null
            ? `RPE ${Math.round(a.perceivedExertion)}`
            : null,
          a.feel != null ? `felt ${a.feel}` : null,
        ]
          .filter(Boolean)
          .join(" · ")
      : a.debriefState === "skipped"
        ? "skipped"
        : a.debriefState === "expired"
          ? "no answer"
          : null;

  return (
    // The emerald tint is a semantic state marker, not a surface, so this card
    // stays translucent where the rest of the slice went opaque. That has a
    // consequence: a 5% tint over the mesh gradient is still, to any contrast
    // measurement, the gradient. --ink-muted is 3.59:1 light / 3.87:1 dark in
    // here and cannot be used, which is why the labels below sit at
    // --ink-secondary while their opposite numbers on the same page (the tile
    // labels, the laps header) are muted inside an opaque bg-surface-raised.
    // See src/lib/design/mesh-composite.ts.
    <section className="rounded-[18px] border border-accent/25 bg-success-tint p-4">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-label font-bold uppercase tracking-[0.15em] text-ink-secondary">
          Debrief
        </h3>
        {answer && (
          <span className="text-label font-bold text-success-ink">
            {answer}
          </span>
        )}
      </div>

      {a.debriefNotes && (
        <p className="mt-2 text-label italic leading-snug text-ink-secondary">
          &ldquo;{a.debriefNotes}&rdquo;
        </p>
      )}

      <div className="mt-3 border-t border-hairline pt-3">
        {review ? (
          <p className="whitespace-pre-wrap text-label leading-[1.55] text-ink-secondary">
            <strong className="font-bold text-coach-ink">Coach: </strong>
            <InlineMarkdown text={review.content} />
          </p>
        ) : (
          <p className="text-label text-ink-secondary">
            Review not generated yet — it&apos;ll appear shortly.
          </p>
        )}
      </div>
    </section>
  );
}
