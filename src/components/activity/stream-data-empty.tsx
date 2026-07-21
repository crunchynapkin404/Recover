import { CloudOff, LineChart } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";

/**
 * The stream-chart section's "no data" branch. `reason` distinguishes a
 * true absence of stream data from a transient fetch failure — the summary
 * stats above are still accurate in the latter case, so the copy says so.
 */
export function StreamDataEmpty({
  reason,
}: {
  reason?: "unavailable" | "fetch_failed";
}) {
  if (reason === "fetch_failed") {
    return (
      <EmptyState
        icon={CloudOff}
        message="Couldn't load detailed data from intervals.icu right now — the summary above is still accurate."
      />
    );
  }
  return (
    <EmptyState
      icon={LineChart}
      message="This activity has no stream data to chart yet."
    />
  );
}
