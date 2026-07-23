"use client";

import Link from "next/link";

const TAGS = [
  { emoji: "☕", label: "Caffeine" },
  { emoji: "🍷", label: "Alcohol" },
  { emoji: "📱", label: "Screen time" },
  { emoji: "🧘", label: "Meditation" },
  { emoji: "💧", label: "Hydration" },
];

export function BehaviorTags() {
  return (
    <div className="glass rounded-[2rem] p-7">
      <div className="mb-5 flex items-center justify-between">
        <span className="label-micro">Yesterday&apos;s Behaviors</span>
        <Link
          href="/body?tab=journal"
          className="text-[11px] font-bold uppercase text-emerald-400"
        >
          + Log
        </Link>
      </div>
      <div className="flex flex-wrap gap-2.5">
        {TAGS.map((tag) => (
          <Link
            key={tag.label}
            href="/body?tab=journal"
            className="glass flex items-center gap-2 rounded-full border-white/10 px-4 py-2 transition-transform active:scale-95"
          >
            <span className="text-xs">{tag.emoji}</span>
            <span className="text-xs font-semibold text-white/90">
              {tag.label}
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}
