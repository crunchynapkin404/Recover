import Link from "next/link";
import type { LogHref } from "@/lib/log-href";

function monthLabel(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });
}

function currentYm(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** Trailing 6 months including the current one, oldest first. */
function recentMonths(): string[] {
  const out: string[] = [];
  const d = new Date();
  d.setDate(1);
  for (let i = 5; i >= 0; i--) {
    const m = new Date(d.getFullYear(), d.getMonth() - i, 1);
    out.push(`${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, "0")}`);
  }
  return out;
}

export function ViewTabs({
  active,
  month,
  href,
}: {
  active: "today" | "week" | "month";
  month: string;
  href: LogHref;
}) {
  const views = [
    ["today", "Today"],
    ["week", "Week"],
    ["month", "Month"],
  ] as const;

  return (
    <div className="mb-6 space-y-4">
      <div className="flex gap-2">
        {views.map(([v, label]) => (
          <Link
            key={v}
            href={href({ view: v })}
            aria-current={active === v ? "true" : undefined}
            className={`flex-1 rounded-full py-2 text-center text-[10px] font-bold uppercase tracking-wider ${
              active === v ? "glass bg-white/10" : "glass opacity-40"
            }`}
          >
            {label}
          </Link>
        ))}
      </div>
      {active === "month" && (
        <div className="hide-scrollbar flex gap-6 overflow-x-auto">
          {recentMonths().map((ym) => (
            <Link
              key={ym}
              href={href({ view: "month", month: ym })}
              aria-current={month === ym ? "true" : undefined}
              className={`relative whitespace-nowrap text-sm font-bold ${
                month === ym ? "text-white" : "opacity-30"
              }`}
            >
              {monthLabel(ym)}
              {month === ym && (
                <span className="absolute -bottom-2 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full bg-blue-400" />
              )}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

export { currentYm };
