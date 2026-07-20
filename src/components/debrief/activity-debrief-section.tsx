import { and, desc, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { feelFromIcu, rpeFromRaw } from "@/lib/debrief/lifecycle";
import { DebriefForm } from "./debrief-form";

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
      <DebriefForm
        activityId={a.id}
        activityName={a.name ?? a.sport}
        prefillRpe={rpeFromRaw(raw)}
        prefillFeel={feelFromIcu(raw?.feel)}
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

  return (
    <section className="glass rounded-[2rem] p-6">
      <h3 className="text-sm font-semibold text-white">Ride review</h3>
      <div className="mt-2 flex gap-3 text-xs text-white/60">
        {a.perceivedExertion != null && (
          <span>RPE {a.perceivedExertion}/10</span>
        )}
        {a.feel != null && <span className="capitalize">Felt {a.feel}</span>}
        {a.debriefState !== "answered" && <span>No feedback given</span>}
      </div>
      {a.debriefNotes && (
        <p className="mt-2 text-xs italic text-white/50">“{a.debriefNotes}”</p>
      )}
      {review ? (
        <p className="mt-3 whitespace-pre-wrap text-sm text-white/80">
          {review.content}
        </p>
      ) : (
        <p className="mt-3 text-xs text-white/40">
          Review not generated yet — it&apos;ll appear shortly.
        </p>
      )}
    </section>
  );
}
