import { PlusCircle } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";

/** Shown above the log form when the user has never logged a manual activity. */
export function ActivityLogEmpty() {
  return (
    <EmptyState
      icon={PlusCircle}
      message="No manual activities logged. Add your first session."
    />
  );
}
