import Link from "next/link";
import { AppShell } from "@/components/app-shell";

// Option B IA (v0.21) — Train is the future home of the current /plan + /log.
// Step 1 stands up the route and its Week · History · Fitness tab skeleton;
// the full hi-fi build that absorbs those modules is step 3. Until then each
// tab points at the module's still-live current page so nothing is lost.
const TABS = [
  {
    key: "week",
    label: "Week",
    href: "/plan",
    blurb:
      "Your living week — the week strip, per-day actions, races and what-changed.",
  },
  {
    key: "history",
    label: "History",
    href: "/log",
    blurb:
      "Past sessions grouped by day, with sport filters and a 7-day strip.",
  },
  {
    key: "fitness",
    label: "Fitness",
    href: "/log",
    blurb: "CTL / ATL / TSB, weekly load bars and your fitness stats.",
  },
] as const;

type Tab = (typeof TABS)[number]["key"];

export default async function TrainPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const { tab } = await searchParams;
  const active: Tab = TABS.find((t) => t.key === tab)?.key ?? "week";
  const current = TABS.find((t) => t.key === active)!;

  return (
    <AppShell>
      <header className="mb-6 pt-8">
        <h1 className="text-[22px] font-bold tracking-tighter">Train</h1>
        <p className="mt-1 text-[10.5px] font-medium text-white/50">
          Week · History · Fitness
        </p>
      </header>

      <nav
        aria-label="Train sections"
        className="mb-6 inline-flex gap-1 rounded-full border border-white/[0.06] bg-white/[0.02] p-1"
      >
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={`/train?tab=${t.key}`}
            aria-current={t.key === active ? "page" : undefined}
            className={`rounded-full px-3.5 py-1.5 text-[11px] font-bold transition-colors ${
              t.key === active
                ? "bg-white/[0.12] text-white"
                : "bg-white/[0.04] text-white/50 hover:text-white/80"
            }`}
          >
            {t.label}
          </Link>
        ))}
      </nav>

      <section className="rounded-[18px] border border-white/[0.08] bg-white/[0.03] p-5">
        <p className="label-micro mb-2">Arriving in this redesign</p>
        <p className="text-[13px] leading-relaxed text-white/70">
          {current.blurb}
        </p>
        <p className="mt-2 text-[12px] leading-relaxed text-white/45">
          The restyled Train tabs land in step 3. For now this section still
          lives on its current page.
        </p>
        <Link
          href={current.href}
          className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-emerald-500 px-4 py-2 text-[11.5px] font-bold text-black transition-opacity hover:opacity-90"
        >
          Open current {current.label} &rarr;
        </Link>
      </section>
    </AppShell>
  );
}
