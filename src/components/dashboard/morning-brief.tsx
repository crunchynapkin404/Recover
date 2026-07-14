import Link from "next/link";
import { Sparkles, ArrowRight } from "lucide-react";

interface Props {
  narrative: string;
}

export function MorningBrief({ narrative }: Props) {
  return (
    <div className="glass rounded-[2rem] border-emerald-500/20 p-6">
      <div className="mb-4 flex items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-emerald-500/10">
          <Sparkles className="ai-sparkle size-[18px] text-emerald-400" />
        </div>
        <span className="text-[11px] font-bold uppercase tracking-[0.2em] text-emerald-400">
          Morning Insights
        </span>
      </div>
      <p className="text-[15px] leading-relaxed text-white/80">{narrative}</p>
      <Link
        href="/coach"
        className="mt-5 inline-flex items-center gap-2 text-[11px] font-bold uppercase tracking-widest text-white/50 transition-colors hover:text-white"
      >
        Chat with Coach
        <ArrowRight className="size-3" />
      </Link>
    </div>
  );
}
