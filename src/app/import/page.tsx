import { AppShell } from "@/components/app-shell";
import { requireUser } from "@/lib/session";
import { ImportForm } from "@/components/import/import-form";

export default async function ImportPage() {
  await requireUser();
  return (
    <AppShell>
      <ImportForm />
    </AppShell>
  );
}
