import { and, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { AppShell } from "@/components/app-shell";
import { IntervalsCard } from "@/components/settings/intervals-card";

export default async function SettingsPage() {
  const user = await requireUser();

  const connection = await db.query.connections.findFirst({
    where: and(
      eq(schema.connections.userId, user.id),
      eq(schema.connections.provider, "intervals_icu")
    ),
  });

  return (
    <AppShell title="Settings">
      <div className="mx-auto grid w-full max-w-2xl gap-6">
        <IntervalsCard
          connection={
            connection
              ? {
                  athleteName:
                    connection.externalAthleteName ??
                    connection.externalAthleteId,
                  status: connection.status,
                  lastSyncAt: connection.lastSyncAt?.toISOString() ?? null,
                  lastError: connection.lastError,
                }
              : null
          }
        />
      </div>
    </AppShell>
  );
}
