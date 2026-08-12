import Link from "next/link";
import { Sparkles } from "lucide-react";
import { InlineMarkdown } from "@/components/ui/inline-markdown";

/**
 * Today's coach brief (2a) — the latest morning insight, clamped to three
 * lines, linking into its coach thread. Data: getLatestMorningInsight.
 */
export function CoachBrief({
  text,
  threadId,
  inboxTeaser,
}: {
  text: string;
  threadId: string;
  /** 3a: what else is waiting in the inbox. Desktop only; null when empty. */
  inboxTeaser?: string | null;
}) {
  return (
    <Link
      href={`/coach?thread=${threadId}`}
      className="block rounded-[20px] glass p-4 transition-colors hover:bg-surface-overlay"
    >
      <div className="mb-2 flex items-center justify-between">
        <span className="flex items-center gap-1.5">
          <Sparkles aria-hidden className="size-3.5 text-coach-ink" />
          <span className="text-label font-bold uppercase tracking-[0.14em] text-ink-muted">
            Coach
          </span>
        </span>
        <span className="text-label font-bold text-accent">Reply &rarr;</span>
      </div>
      <p className="line-clamp-3 text-caption leading-[1.55] text-ink-secondary">
        <InlineMarkdown text={text} />
      </p>
      {inboxTeaser && (
        <p className="mt-3 hidden border-t border-hairline pt-2.5 text-label text-ink-muted lg:block">
          {inboxTeaser}
        </p>
      )}
    </Link>
  );
}
