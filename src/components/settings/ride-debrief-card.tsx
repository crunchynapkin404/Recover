import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { RideDebriefToggles } from "./ride-debrief-toggles";

export async function RideDebriefCard() {
  const user = await requireUser();
  const prefs = await db.query.notificationPrefs.findFirst({
    where: eq(schema.notificationPrefs.userId, user.id),
  });
  return (
    <RideDebriefToggles
      rideDebriefsEnabled={prefs?.rideDebriefsEnabled ?? true}
      debriefPushEnabled={prefs?.debriefPushEnabled ?? false}
    />
  );
}
