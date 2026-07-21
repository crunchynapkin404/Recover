import { and, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { AppShell } from "@/components/app-shell";
import { requireUser } from "@/lib/session";
import { ActivityLogForm } from "@/components/activity/activity-log-form";
import { ActivityLogEmpty } from "@/components/activity/activity-log-empty";

export default async function LogActivityPage() {
  const user = await requireUser();
  const existing = await db.query.activities.findFirst({
    where: and(
      eq(schema.activities.userId, user.id),
      eq(schema.activities.provider, "manual")
    ),
  });
  return (
    <AppShell>
      <ActivityLogForm />
      {!existing && (
        <div className="mt-6">
          <ActivityLogEmpty />
        </div>
      )}
    </AppShell>
  );
}
