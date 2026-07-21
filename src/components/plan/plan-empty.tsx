import Link from "next/link";
import { ClipboardList } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";

/** No active training plan — the page's true "no data" state. */
export function PlanEmpty() {
  return (
    <div className="space-y-4">
      <EmptyState
        icon={ClipboardList}
        message="No plan yet — generate one from a race goal, or plan just this week."
      />
      <Link
        href="/coach"
        className="block text-center text-sm font-bold text-emerald-400"
      >
        Talk to the coach
      </Link>
    </div>
  );
}
