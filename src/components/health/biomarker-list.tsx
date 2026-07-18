import type { BiomarkerCategory } from "@/lib/health-records";

export interface BiomarkerRow {
  name: string;
  displayName: string;
  category: BiomarkerCategory;
  value: number;
  unit: string | null;
  measuredAt: string;
  source: string;
  /** Previous measurement for a direction arrow, if any. */
  prevValue: number | null;
}

const CATEGORY_LABELS: Record<BiomarkerCategory, string> = {
  lipids: "Lipids",
  metabolic: "Metabolic",
  hematology: "Hematology",
  hormones: "Hormones",
  vitamins: "Vitamins",
  organ: "Organ & inflammation",
  other: "Other",
};

const CATEGORY_ORDER: BiomarkerCategory[] = [
  "lipids",
  "metabolic",
  "hematology",
  "hormones",
  "vitamins",
  "organ",
  "other",
];

function arrow(value: number, prev: number | null): string {
  if (prev == null) return "";
  if (value > prev) return "▲";
  if (value < prev) return "▼";
  return "→";
}

/** Latest value per biomarker, grouped by category. Empty groups are hidden. */
export function BiomarkerList({ rows }: { rows: BiomarkerRow[] }) {
  if (rows.length === 0) {
    return (
      <div className="glass rounded-[2rem] p-6">
        <span className="label-micro">Biomarkers</span>
        <p className="mt-3 text-sm text-white/50">
          No blood work yet. Add a test above and your markers will trend here.
        </p>
      </div>
    );
  }

  const byCat = new Map<BiomarkerCategory, BiomarkerRow[]>();
  for (const r of rows) {
    const list = byCat.get(r.category) ?? [];
    list.push(r);
    byCat.set(r.category, list);
  }

  return (
    <div className="glass rounded-[2rem] p-6">
      <span className="label-micro">Biomarkers</span>
      <div className="mt-4 space-y-5">
        {CATEGORY_ORDER.filter((c) => byCat.has(c)).map((cat) => (
          <div key={cat}>
            <p className="text-[10px] font-bold uppercase tracking-wider text-white/40">
              {CATEGORY_LABELS[cat]}
            </p>
            <div className="mt-2 divide-y divide-white/5">
              {byCat
                .get(cat)!
                .sort((a, b) => a.displayName.localeCompare(b.displayName))
                .map((r) => (
                  <div
                    key={r.name}
                    className="flex items-baseline justify-between py-2"
                  >
                    <span className="text-sm text-white/80">
                      {r.displayName}
                    </span>
                    <span className="text-sm font-bold tabular-nums text-white">
                      {arrow(r.value, r.prevValue)} {r.value}
                      {r.unit && (
                        <span className="ml-1 text-[11px] font-normal text-white/40">
                          {r.unit}
                        </span>
                      )}
                    </span>
                  </div>
                ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
