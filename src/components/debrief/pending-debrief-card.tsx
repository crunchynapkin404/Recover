import { and, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { feelFromIcu, rpeFromRaw } from "@/lib/debrief/lifecycle";
import { DebriefForm } from "./debrief-form";

export async function PendingDebriefCard({ userId }: { userId: string }) {
  const pending = await db.query.activities.findFirst({
    where: and(
      eq(schema.activities.userId, userId),
      eq(schema.activities.debriefState, "pending")
    ),
  });
  if (!pending) return null;
  const raw = pending.raw as Record<string, unknown> | null;
  return (
    <DebriefForm
      activityId={pending.id}
      activityName={pending.name ?? pending.sport}
      prefillRpe={rpeFromRaw(raw)}
      prefillFeel={feelFromIcu(raw?.feel)}
    />
  );
}
