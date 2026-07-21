export type LogView = "today" | "week" | "month";

export type LogFilterState = {
  view: LogView;
  month: string;
  range: number;
  sport: string;
};

export type LogHrefOverride = {
  view?: LogView;
  month?: string;
  range?: number;
  sport?: string;
};

export type LogHref = (over: LogHrefOverride) => string;

/**
 * Builds a /log URL that keeps the rest of the filter state intact when
 * only one axis (view, month, range, sport) changes. Shared by ViewTabs,
 * RangeTabs, and the sport-filter chips on the performance-log page — this
 * is the v0.19 fix for hrefs that silently dropped sibling state on click.
 * "" clears the sport filter.
 */
export function buildLogHref(
  current: LogFilterState,
  over: LogHrefOverride
): string {
  const v = over.view !== undefined ? over.view : current.view;
  const m = over.month !== undefined ? over.month : current.month;
  const r = over.range !== undefined ? over.range : current.range;
  const s = over.sport !== undefined ? over.sport : current.sport;
  const q = new URLSearchParams({ view: v, range: String(r) });
  if (v === "month") q.set("month", m);
  if (s) q.set("sport", s);
  return `/log?${q.toString()}`;
}
