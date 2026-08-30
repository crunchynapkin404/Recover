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
    // `full` used to render the message ALONE and silently drop `state.fix`,
    // so a caller could hand the component a fix and watch it disappear. All
    // three first-run screens (Train, Body, Coach) worked around it by
    // hand-rendering the link as a sibling — which meant the label and the
    // href each existed twice per site, in the state object and again in the
    // markup, free to drift apart. Rendering it here is the honest fix; the
    // three workarounds are gone.
    //
    // The action sits BELOW the panel rather than inside it, matching
    // PlanEmpty — the house pattern for an empty state that offers one. The
    // filled treatment (rather than PlanEmpty's text link) is deliberate:
    // on a first-run screen this is the only thing to do.
    if (!fix) return <EmptyState icon={CircleDashed} message={text} />;
    return (
      <div className="space-y-4">
        <EmptyState icon={CircleDashed} message={text} />
        <Link
          href={fix.href}
          className="inline-flex items-center justify-center gap-2 rounded-2xl bg-accent px-6 py-3 font-bold text-accent-foreground transition-colors hover:bg-accent/90"
        >
          {fix.label}
        </Link>
      </div>
    );
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
