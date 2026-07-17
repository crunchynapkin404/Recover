import { AUTO_TAGS, addDaysYmd } from "./auto-tags";
import { mean, welchCompare } from "./stats";

export const MIN_EVENTS = 5;
export const WINDOW_DAYS = 90;

export interface SplitInsight {
  impactPct: number;
  ciHalfWidthPct: number;
  conclusive: boolean;
  events: number;
}

export interface TagInsight {
  emoji: string;
  behavior: string;
  auto: boolean;
  impactPct: number; // signed, rounded percentage points
  ciHalfWidthPct: number; // 95% CI half-width, rounded pp
  conclusive: boolean; // CI does not cross zero
  events: number;
  splits: { weekday: SplitInsight | null; weekend: SplitInsight | null };
}

export interface CorrelateInput {
  manualTagsByDate: Map<string, string[]>;
  autoTagsByDate: Map<string, string[]>;
  readinessByDate: Map<string, number>;
}

function splitTag(tag: string): { emoji: string; behavior: string } {
  const match = tag.match(/^(\p{Extended_Pictographic}️?)\s*(.*)$/u);
  if (match) return { emoji: match[1], behavior: match[2] || tag };
  return { emoji: "🏷️", behavior: tag };
}

function isWeekend(ymd: string): boolean {
  const dow = new Date(`${ymd}T00:00:00`).getDay();
  return dow === 0 || dow === 6;
}

interface DayObs {
  date: string;
  next: number; // next-day readiness
  tags: Set<string>;
}

/**
 * Per-tag two-sample comparison: days carrying the tag vs days without it
 * (per-tag baseline — with 😴 Rest day in play most days carry some tag,
 * so an "untagged overall" baseline would be nearly empty).
 */
function compare(
  universe: DayObs[],
  tag: string
): Omit<TagInsight, "emoji" | "behavior" | "auto" | "splits"> | null {
  const tagged = universe.filter((u) => u.tags.has(tag)).map((u) => u.next);
  const untagged = universe.filter((u) => !u.tags.has(tag)).map((u) => u.next);
  if (tagged.length < MIN_EVENTS) return null;
  const w = welchCompare(tagged, untagged);
  if (!w) return null;
  const base = mean(untagged);
  if (base <= 0) return null;
  return {
    impactPct: Math.round((w.diff / base) * 100),
    ciHalfWidthPct: Math.round((w.halfWidth / base) * 100),
    conclusive: w.conclusive,
    events: tagged.length,
  };
}

export function correlateTags(input: CorrelateInput): TagInsight[] {
  const manualTags = new Set<string>();
  for (const tags of input.manualTagsByDate.values())
    for (const t of tags) manualTags.add(t);

  // Universe: every day whose NEXT day has a readiness score. Days with
  // readiness but no tags still belong to every per-tag baseline.
  const allDates = new Set<string>([
    ...input.manualTagsByDate.keys(),
    ...input.autoTagsByDate.keys(),
  ]);
  for (const d of input.readinessByDate.keys()) allDates.add(addDaysYmd(d, -1));

  const universe: DayObs[] = [];
  for (const date of allDates) {
    const next = input.readinessByDate.get(addDaysYmd(date, 1));
    if (next == null) continue;
    universe.push({
      date,
      next,
      tags: new Set([
        ...(input.manualTagsByDate.get(date) ?? []),
        ...(input.autoTagsByDate.get(date) ?? []),
      ]),
    });
  }

  const allTags = new Set<string>();
  for (const u of universe) for (const t of u.tags) allTags.add(t);

  const weekdayU = universe.filter((u) => !isWeekend(u.date));
  const weekendU = universe.filter((u) => isWeekend(u.date));

  const out: TagInsight[] = [];
  for (const tag of allTags) {
    const headline = compare(universe, tag);
    if (!headline) continue;
    out.push({
      ...splitTag(tag),
      auto: AUTO_TAGS.has(tag) && !manualTags.has(tag),
      ...headline,
      splits: {
        weekday: compare(weekdayU, tag),
        weekend: compare(weekendU, tag),
      },
    });
  }

  return out.sort((a, b) => {
    if (a.conclusive !== b.conclusive) return a.conclusive ? -1 : 1;
    return a.conclusive
      ? Math.abs(b.impactPct) - Math.abs(a.impactPct)
      : b.events - a.events;
  });
}
