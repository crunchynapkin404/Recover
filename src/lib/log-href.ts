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

export const TRAIN_DEFAULTS = { view: "week", range: 90 } as const;

export type BodyTab = "trends" | "sleep" | "journal" | "labs";

export const BODY_TABS: BodyTab[] = ["trends", "sleep", "journal", "labs"];

export type BodyHref = (over: { tab?: BodyTab; range?: number }) => string;

/**
 * Builds a /body URL. Body has two axes — the segment and the trend range —
 * and the same rule as everywhere else: changing one keeps the other. The
 * default range is omitted so a plain segment link stays readable.
 */
export function buildBodyHref(
  current: { tab: BodyTab; range: number },
  over: { tab?: BodyTab; range?: number }
): string {
  const t = over.tab !== undefined ? over.tab : current.tab;
  const r = over.range !== undefined ? over.range : current.range;
  const q = new URLSearchParams({ tab: t });
  if (r !== TRAIN_DEFAULTS.range) q.set("range", String(r));
  return `/body?${q.toString()}`;
}

export type TrainTab = "week" | "history" | "fitness";

export const TRAIN_TABS: TrainTab[] = ["week", "history", "fitness"];

export type TrainFilterState = LogFilterState & { tab: TrainTab };

export type TrainHrefOverride = LogHrefOverride & { tab?: TrainTab };

export type TrainHref = (over: TrainHrefOverride) => string;

/**
 * Builds a /train URL. Same contract as buildLogHref — changing one axis
 * never drops the others — with the segment (tab) as a fourth axis, so
 * flipping Week → Fitness → History round-trips back to the sport filter
 * and month the athlete had chosen. Defaults are omitted to keep the URL
 * readable; "" clears the sport filter.
 */
export function buildTrainHref(
  current: TrainFilterState,
  over: TrainHrefOverride
): string {
  const t = over.tab !== undefined ? over.tab : current.tab;
  const v = over.view !== undefined ? over.view : current.view;
  const m = over.month !== undefined ? over.month : current.month;
  const r = over.range !== undefined ? over.range : current.range;
  const s = over.sport !== undefined ? over.sport : current.sport;
  const q = new URLSearchParams({ tab: t });
  if (v !== TRAIN_DEFAULTS.view) q.set("view", v);
  if (v === "month") q.set("month", m);
  if (r !== TRAIN_DEFAULTS.range) q.set("range", String(r));
  if (s) q.set("sport", s);
  return `/train?${q.toString()}`;
}
