import { FlaskConical } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
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
    // Rendered bare, not inside a `.glass` wrapper (F3, v0.102 task 12,
    // browser pass — same defect class as v0.101.1's
    // "stop nesting .glass inside .glass on the Fitness empty state"):
    // EmptyState's own root is `.glass`, so wrapping it in another `.glass`
    // card stacked two translucent, blurred fills — a card inside a card.
    // The "Biomarkers" label stays outside the card, matching how the
    // Fitness fix keeps its heading unwrapped too.
    return (
      <div>
        <span className="label-micro">Biomarkers</span>
        <div className="mt-3">
          <EmptyState
            icon={FlaskConical}
            message="No biomarkers yet — upload a blood test or add a reading."
          />
        </div>
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
            <p className="text-label font-bold uppercase tracking-wider text-ink-muted">
              {CATEGORY_LABELS[cat]}
            </p>
            <div className="mt-2 divide-y divide-hairline">
              {byCat
                .get(cat)!
                .sort((a, b) => a.displayName.localeCompare(b.displayName))
                .map((r) => (
                  <div
                    key={r.name}
                    className="flex items-baseline justify-between py-2"
                  >
                    <span className="text-caption text-ink-secondary">
                      {r.displayName}
                    </span>
                    <span className="text-caption font-bold font-numeric text-ink-primary">
                      {arrow(r.value, r.prevValue)} {r.value}
                      {r.unit && (
                        <span className="ml-1 text-label font-normal text-ink-muted">
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
