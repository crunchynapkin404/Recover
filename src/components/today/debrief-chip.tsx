import { and, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { feelFromIcu, rpeFromRaw } from "@/lib/debrief/lifecycle";
import { DebriefForm } from "@/components/debrief/debrief-form";
import { DebriefDisclosure } from "./debrief-disclosure";

/**
 * Server wrapper for the Today debrief chip — same pending-activity query as
 * PendingDebriefCard, which it replaces on this page. Renders nothing when no
 * debrief is pending.
 */
export async function DebriefChip({ userId }: { userId: string }) {
  const pending = await db.query.activities.findFirst({
    where: and(
      eq(schema.activities.userId, userId),
      eq(schema.activities.debriefState, "pending")
    ),
  });
  if (!pending) return null;
  const raw = pending.raw as Record<string, unknown> | null;
  const name = pending.name ?? pending.sport;
  return (
    <DebriefDisclosure name={name}>
      <DebriefForm
        activityId={pending.id}
        activityName={name}
        prefillRpe={rpeFromRaw(raw)}
        prefillFeel={feelFromIcu(raw?.feel)}
      />
    </DebriefDisclosure>
  );
}
