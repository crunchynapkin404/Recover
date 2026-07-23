import Link from "next/link";
import { AppShell } from "@/components/app-shell";

// Option B IA (v0.21) — Body absorbs wellness trends, sleep detail, journal
// insights and labs. Step 1 stands up the route and its Trends · Sleep ·
// Journal · Labs tab skeleton; the full composition is step 4. Each tab links
// to the module's still-live current home. The daily sleep signal stays on
// Today's vitals grid; the detailed stage/battery view arrives with Body.
const TABS = [
  {
    key: "trends",
    label: "Trends",
    href: "/log?view=week",
    cta: "current trends",
    blurb: "HRV & RHR against your own baseline bands.",
  },
  {
    key: "sleep",
    label: "Sleep",
    href: "/",
    cta: "today's sleep",
    blurb:
      "Last night's stages, consistency and body battery. The daily sleep tile stays on Today.",
  },
  {
    key: "journal",
    label: "Journal",
    href: "/journal",
    cta: "current journal",
    blurb: "Behavior correlations, milestones and your check-in streak.",
  },
  {
    key: "labs",
    label: "Labs",
    href: "/health",
    cta: "current labs",
    blurb: "Biomarkers, biological age and blood pressure.",
  },
] as const;

type Tab = (typeof TABS)[number]["key"];

export default async function BodyPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const { tab } = await searchParams;
  const active: Tab = TABS.find((t) => t.key === tab)?.key ?? "trends";
  const current = TABS.find((t) => t.key === active)!;

  return (
    <AppShell>
      <header className="mb-6 pt-8">
        <h1 className="text-[22px] font-bold tracking-tighter">Body</h1>
        <p className="mt-1 text-[10.5px] font-medium text-white/50">
          Trends · Sleep · Journal · Labs
        </p>
      </header>

      <nav
        aria-label="Body sections"
        className="mb-6 inline-flex gap-1 rounded-full border border-white/[0.06] bg-white/[0.02] p-1"
      >
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={`/body?tab=${t.key}`}
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
          The assembled Body page lands in step 4. For now this section still
          lives on its current page.
        </p>
        <Link
          href={current.href}
          className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-emerald-500 px-4 py-2 text-[11.5px] font-bold text-black transition-opacity hover:opacity-90"
        >
          Open {current.cta} &rarr;
        </Link>
      </section>
    </AppShell>
  );
}
