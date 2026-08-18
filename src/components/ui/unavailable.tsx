import Link from "next/link";
import { CircleDashed } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import type { Unavailable as UnavailableState } from "@/lib/uncertainty";

export function unavailableMessage(state: UnavailableState): string {
  switch (state.kind) {
    case "calibrating":
      return `Calibrating — day ${state.have} of ${state.need} ${state.unit}`;
    case "missing_input":
      return `Needs ${state.needs}`;
    case "not_applicable":
      return state.why;
  }
}

/** Inline by default; pass `full` for a full-panel empty-state treatment. */
export function Unavailable({
  state,
  full = false,
}: {
  state: UnavailableState;
  full?: boolean;
}) {
  const text = unavailableMessage(state);
  const fix = state.kind === "missing_input" ? state.fix : undefined;

  if (full) {
    return <EmptyState icon={CircleDashed} message={text} />;
  }

  return (
    <span data-slot="unavailable" className="text-ink-secondary">
      {text}
      {fix && (
        <>
          {" "}
          <Link href={fix.href} className="underline">
            {fix.label}
          </Link>
        </>
      )}
    </span>
  );
}
