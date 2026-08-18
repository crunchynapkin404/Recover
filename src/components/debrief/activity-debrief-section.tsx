import { and, desc, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import {
  feelFromIcu,
  formatActivityMetrics,
  rpeFromRaw,
} from "@/lib/debrief/lifecycle";
import { DebriefSheet } from "./debrief-sheet";
import { InlineMarkdown } from "@/components/ui/inline-markdown";

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

  if (a.debriefState === "pending") {
    const raw = a.raw as Record<string, unknown> | null;
    return (
      <DebriefSheet
        activityId={a.id}
        activityName={a.name ?? a.sport}
        metrics={formatActivityMetrics(a)}
        prefillRpe={rpeFromRaw(raw)}
        prefillFeel={feelFromIcu(raw?.feel)}
        closeHref={`/activity/${a.id}`}
      />
    );
  }

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
    <section className="rounded-[18px] border border-emerald-500/25 bg-emerald-500/[0.05] p-4">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-label font-bold uppercase tracking-[0.15em] text-ink-secondary">
          Debrief
        </h3>
        {answer && (
          <span className="text-label font-bold text-emerald-400">
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
            <strong className="font-bold text-violet-400">Coach: </strong>
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
