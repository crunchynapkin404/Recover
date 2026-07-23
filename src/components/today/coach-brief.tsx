import Link from "next/link";
import { Sparkles } from "lucide-react";

/**
 * Today's coach brief (2a) — the latest morning insight, clamped to three
 * lines, linking into its coach thread. Data: getLatestMorningInsight.
 */
export function CoachBrief({
  text,
  threadId,
}: {
  text: string;
  threadId: string;
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
        {text}
      </p>
    </Link>
  );
}
