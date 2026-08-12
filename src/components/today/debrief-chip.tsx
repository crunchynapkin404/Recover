import Link from "next/link";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";

/**
 * Today's debrief chip (2a) — the one-line prompt when a ride is waiting on
 * the athlete's word. Tapping it opens sheet 1i, the same sheet the
 * post-sync push deep-links to, so both routes land in one place.
 */
export async function DebriefChip({ userId }: { userId: string }) {
  const pending = await db.query.activities.findFirst({
    where: and(
      eq(schema.activities.userId, userId),
      eq(schema.activities.debriefState, "pending")
    ),
  });
  if (!pending) return null;
  const name = pending.name ?? pending.sport;

  return (
    <Link
      href={`/?sheet=debrief&activity=${pending.id}`}
      className="flex items-center justify-between rounded-[14px] border border-hairline bg-surface-raised px-3.5 py-2.5 transition-colors hover:bg-surface-overlay"
    >
      <span className="text-caption text-ink-secondary">
        How was <strong className="font-bold text-ink-primary">{name}</strong>?
      </span>
      <span className="shrink-0 text-label font-bold text-accent">
        Debrief · 30s →
      </span>
    </Link>
  );
}
