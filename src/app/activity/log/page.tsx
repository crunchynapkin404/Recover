import { AppShell } from "@/components/app-shell";
import { requireUser } from "@/lib/session";
import { ActivityLogForm } from "@/components/activity/activity-log-form";

export default async function LogActivityPage() {
  await requireUser();
  return (
    <AppShell>
      <ActivityLogForm />
    </AppShell>
  );
}
