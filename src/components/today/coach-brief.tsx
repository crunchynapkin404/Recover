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
      className="mb-6 block rounded-[20px] border border-white/10 bg-white/5 p-3.5 transition-colors hover:bg-white/[0.07]"
    >
      <div className="mb-2 flex items-center justify-between">
        <span className="flex items-center gap-1.5">
          <Sparkles
            aria-hidden
            className="size-3.5"
            style={{ color: "#a78bfa" }}
          />
          <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/40">
            Coach
          </span>
        </span>
        <span className="text-[10.5px] font-bold text-emerald-400">
          Reply &rarr;
        </span>
      </div>
      <p className="line-clamp-3 text-[12.5px] leading-[1.55] text-white/75">
        <InlineMarkdown text={text} />
      </p>
      {inboxTeaser && (
        <p className="mt-3 hidden border-t border-white/[0.06] pt-2.5 text-[10.5px] text-white/35 lg:block">
          {inboxTeaser}
        </p>
      )}
    </Link>
  );
}
