import { Badge } from "@/components/ui/badge";
import type { Confidence } from "@/lib/uncertainty";

const LABEL: Record<"low" | "medium", string> = {
  low: "Low confidence",
  medium: "Medium confidence",
};

/** Nothing renders at high confidence — that is the unmarked default. */
export function ConfidenceChip({ level }: { level: Confidence }) {
  if (level === "high") return null;
  return (
    <Badge variant="outline" data-slot="confidence-chip">
      {LABEL[level]}
    </Badge>
  );
}
