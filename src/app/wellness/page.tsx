import { requireUser } from "@/lib/session";
import { AppShell } from "@/components/app-shell";
import { WellnessForm } from "@/components/wellness-form";

export default async function WellnessPage() {
  await requireUser();

  return (
    <AppShell title="Log wellness">
      <div className="mx-auto w-full max-w-2xl">
        <WellnessForm />
      </div>
    </AppShell>
  );
}
