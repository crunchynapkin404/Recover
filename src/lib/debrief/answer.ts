/** v0.15 debrief answers — DB logic behind the server actions (testable
 * without a session). Untouched fields arrive as null and write nothing. */
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";

export interface DebriefInput {
  rpe: number | null;
  feel: "strong" | "normal" | "weak" | null;
  notes: string | null;
}

export interface DebriefResult {
  ok: boolean;
  message?: string;
}

async function pendingActivity(userId: string, activityId: string) {
  return db.query.activities.findFirst({
    where: and(
      eq(schema.activities.id, activityId),
      eq(schema.activities.userId, userId),
      eq(schema.activities.debriefState, "pending")
    ),
  });
}

export async function storeDebriefAnswer(
  userId: string,
  activityId: string,
  input: DebriefInput
): Promise<DebriefResult> {
  if (input.rpe != null && (input.rpe < 1 || input.rpe > 10)) {
    return { ok: false, message: "RPE must be 1–10." };
  }
  const notes = input.notes?.trim() || null;
  if (notes && notes.length > 2000) {
    return { ok: false, message: "Notes are limited to 2000 characters." };
  }
  const a = await pendingActivity(userId, activityId);
  if (!a) return { ok: false, message: "No pending debrief for this ride." };
  const rows = await db
    .update(schema.activities)
    .set({
      debriefState: "answered",
      // Honest input: only provided fields are written.
      ...(input.rpe != null ? { perceivedExertion: input.rpe } : {}),
      ...(input.feel != null ? { feel: input.feel } : {}),
      ...(notes != null ? { debriefNotes: notes } : {}),
    })
    .where(
      and(
        eq(schema.activities.id, activityId),
        eq(schema.activities.debriefState, "pending")
      )
    )
    .returning();
  if (rows.length === 0)
    return { ok: false, message: "No pending debrief for this ride." };
  return { ok: true };
}

export async function storeDebriefSkip(
  userId: string,
  activityId: string
): Promise<DebriefResult> {
  const a = await pendingActivity(userId, activityId);
  if (!a) return { ok: false, message: "No pending debrief for this ride." };
  const rows = await db
    .update(schema.activities)
    .set({ debriefState: "skipped" })
    .where(
      and(
        eq(schema.activities.id, activityId),
        eq(schema.activities.debriefState, "pending")
      )
    )
    .returning();
  if (rows.length === 0)
    return { ok: false, message: "No pending debrief for this ride." };
  return { ok: true };
}
