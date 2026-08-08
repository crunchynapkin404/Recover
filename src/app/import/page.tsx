import { AppShell } from "@/components/app-shell";
import { requireUser } from "@/lib/session";
import { recordSurfaceView } from "@/lib/telemetry";
import { ImportForm } from "@/components/import/import-form";

export default async function ImportPage() {
  const user = await requireUser();
  await recordSurfaceView(user.id, "import");
  return (
    <AppShell>
      <ImportForm />
    </AppShell>
  );
}
