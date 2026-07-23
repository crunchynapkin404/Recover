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
    <section className="rounded-[18px] border border-emerald-500/25 bg-emerald-500/[0.05] p-4">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-[9.5px] font-bold uppercase tracking-[0.15em] text-white/40">
          Debrief
        </h3>
        {answer && (
          <span className="text-[10.5px] font-bold text-emerald-400">
            {answer}
          </span>
        )}
      </div>

      {a.debriefNotes && (
        <p className="mt-2 text-[12px] italic leading-snug text-white/60">
          &ldquo;{a.debriefNotes}&rdquo;
        </p>
      )}

      <div className="mt-3 border-t border-white/[0.08] pt-3">
        {review ? (
          <p className="whitespace-pre-wrap text-[11.5px] leading-[1.55] text-white/80">
            <strong className="font-bold text-violet-400">Coach: </strong>
            <InlineMarkdown text={review.content} />
          </p>
        ) : (
          <p className="text-[11px] text-white/40">
            Review not generated yet — it&apos;ll appear shortly.
          </p>
        )}
      </div>
    </section>
  );
}
