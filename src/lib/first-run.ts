/**
 * Has this athlete got nothing at all yet?
 *
 * One source of truth for the first-run question, because four surfaces now
 * ask it. The same "one resolver, not two" reasoning as resolveFtpAnchor().
 *
 * "No wellness" means EVER, not recently. src/app/page.tsx used to decide
 * this inline against a 90-day window, which treated an athlete who logged
 * for a year, stopped, and came back as brand new. Counting all of history
 * is the stricter reading, and it is what makes the first-run treatment safe
 * to show: it can never tell an established athlete to go connect a device.
 */
import { db, schema } from "@/lib/db";
import { and, eq } from "drizzle-orm";

export async function isFirstRun(userId: string): Promise<boolean> {
  const connection = await db.query.connections.findFirst({
    where: and(
      eq(schema.connections.userId, userId),
      eq(schema.connections.status, "active")
    ),
    columns: { id: true },
  });
  if (connection) return false;

  const anyWellness = await db.query.wellnessDaily.findFirst({
    where: eq(schema.wellnessDaily.userId, userId),
    columns: { id: true },
  });
  return anyWellness == null;
}
