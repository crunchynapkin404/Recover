"use client";

import Link from "next/link";
import { useTransition } from "react";
import { dismissAnchorPrompt } from "@/app/settings/body-actions";
import type { MissingAnchors } from "@/lib/anchors-needed";

/**
 * The one place an athlete is asked for a number.
 *
 * isFirstRun() returns false the moment a connection goes active, so an
 * athlete who connected a device has never been asked for an anchor. Counted
 * in production on 2026-09-02, nobody had a threshold pace: every run figure
 * was Low by construction, and every "Set it" link landed at the top of a
 * six-drawer page whose baselines badge read "FTP 250".
 *
 * Sport-gated upstream in missingAnchors(), so a cyclist is never asked for
 * a pace. Both gaps render as ONE block with ONE dismiss — two stacked
 * prompts on Today is a nag rather than a question.
 *
 * It renders null whenever nothing is missing, which is what lets it sit in
 * all three BLOCK_ORDER states without costing an anchored athlete anything
 * — the same argument dayLog and bedtime carry in block-order.ts.
 */
const GAPS = {
  pace: {
    noun: "threshold pace",
    href: "/settings?open=baselines#threshold-pace",
    why: "Your run figures are estimated from recent sessions rather than measured against a number you set.",
  },
  ftp: {
    noun: "FTP",
    href: "/settings?open=baselines#ftp-outdoor",
    why: "Your ride targets fall back to a synced estimate rather than your own figure.",
  },
} as const;

type Gap = (typeof GAPS)[keyof typeof GAPS];

export function AnchorPrompt({ missing }: { missing: MissingAnchors }) {
  const [pending, startTransition] = useTransition();

  const gaps: Gap[] = [
    missing.pace ? GAPS.pace : null,
    missing.ftp ? GAPS.ftp : null,
  ].filter((g): g is Gap => g !== null);

  if (missing.dismissed || gaps.length === 0) return null;

  return (
    <div className="rounded-[20px] glass glass-no-hover p-4">
      <span className="text-label font-bold uppercase tracking-[0.14em] text-ink-muted">
        {gaps.length === 1 ? "Set your anchor" : "Set your anchors"}
      </span>
      <p className="mt-2 text-caption leading-relaxed text-ink-secondary">
        Recover has no {gaps.map((g) => g.noun).join(" and no ")} for you.{" "}
        {gaps.map((g) => g.why).join(" ")}
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {gaps.map((g) => (
          <Link
            key={g.noun}
            href={g.href}
            className="rounded-2xl bg-accent px-4 py-2 text-label font-bold text-accent-foreground transition-colors hover:bg-accent/90"
          >
            Set your {g.noun}
          </Link>
        ))}
        <button
          type="button"
          disabled={pending}
          aria-busy={pending}
          onClick={() => startTransition(() => void dismissAnchorPrompt())}
          className="rounded-2xl px-4 py-2 text-label font-bold text-ink-muted transition-colors hover:text-ink-secondary disabled:opacity-60"
        >
          Not now
        </button>
      </div>
    </div>
  );
}
